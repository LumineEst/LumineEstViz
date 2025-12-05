importScripts('libs/highs.js');

self.onmessage = async function (e) {
    const { type, elements, models } = e.data;

    if (type === 'SOLVE_SALBP') {
        try {
            // FIX: Explicitly tell Emscripten where to find the WASM file
            const highs = await Module({
                locateFile: (file) => 'libs/' + file
            });

            const { taskData, precedenceGraph, totalWorkContent, maxTaskTime } = processInputData(elements, models);

            const results = {};
            const MIN_STATIONS = 3;
            // Dynamic max stations based on atomic task limits
            const calculatedMaxStations = Math.ceil(totalWorkContent / maxTaskTime);
            const MAX_STATIONS = Math.max(MIN_STATIONS, calculatedMaxStations);

            for (let m = MIN_STATIONS; m <= MAX_STATIONS; m++) {
                const lowerBoundC = Math.max(maxTaskTime, totalWorkContent / m);
                const upperBoundC = totalWorkContent;

                const solution = solveSALBP2(highs, taskData, precedenceGraph, m, lowerBoundC, upperBoundC);

                if (solution.status === 'Optimal') {
                    results[m] = formatSolution(solution, m);
                } else {
                    console.warn(`Could not find optimal solution for ${m} stations.`);
                }
            }

            self.postMessage({ success: true, configData: results });

        } catch (error) {
            self.postMessage({ success: false, error: error.message || "Unknown Worker Error" });
        }
    }
};

function processInputData(elements, models) {
    let maxTaskTime = 0;
    let totalWorkContent = 0;

    const taskData = elements.map(el => {
        let weightedTime = 0;
        let totalRatio = 0;

        models.forEach(model => {
            if (el.usage.includes(model.id)) {
                weightedTime += el.baseTime * model.ratio;
                totalRatio += model.ratio;
            }
        });

        const effectiveTime = totalRatio > 0 ? weightedTime : el.baseTime;

        maxTaskTime = Math.max(maxTaskTime, effectiveTime);
        totalWorkContent += effectiveTime;

        return {
            id: el.id,
            time: effectiveTime,
            predecessors: el.predecessors || []
        };
    });

    return { taskData, precedenceGraph: taskData, totalWorkContent, maxTaskTime };
}

function solveSALBP2(highs, tasks, graph, m, lb, ub) {
    let lp = "Minimize\n obj: C\nSubject To\n";
    const binaryVars = [];

    // Cycle Time Constraints
    for (let j = 1; j <= m; j++) {
        let line = "";
        tasks.forEach(task => { line += ` + ${task.time} x_${task.id}_${j}`; });
        line += ` - C <= 0\n`;
        lp += line;
    }

    // Assignment Constraints
    tasks.forEach(task => {
        let line = "";
        for (let j = 1; j <= m; j++) {
            line += ` + 1 x_${task.id}_${j}`;
            binaryVars.push(`x_${task.id}_${j}`);
        }
        line += ` = 1\n`;
        lp += line;
    });

    // Precedence Constraints
    tasks.forEach(task => {
        task.predecessors.forEach(predId => {
            if (tasks.find(t => t.id === predId)) {
                let line = "";
                for (let j = 1; j <= m; j++) {
                    line += ` + ${j} x_${predId}_${j}`;
                    line += ` - ${j} x_${task.id}_${j}`;
                }
                line += ` <= 0\n`;
                lp += line;
            }
        });
    });

    lp += `Bounds\n ${lb} <= C <= ${ub}\nBinary\n`;
    binaryVars.forEach(v => { lp += ` ${v}\n`; });
    lp += "End";

    try {
        const result = highs.solve(lp);
        return { status: result.Status, columns: result.Columns, obj: result.ObjectiveValue };
    } catch (e) {
        return { status: 'Error' };
    }
}

function formatSolution(solution, m) {
    const assignments = {};
    for (let j = 1; j <= m; j++) assignments[j] = [];
    Object.keys(solution.columns).forEach(key => {
        if (key.startsWith('x_') && solution.columns[key].Primal > 0.9) {
            const parts = key.split('_');
            if (!assignments[parts[2]]) assignments[parts[2]] = [];
            assignments[parts[2]].push(parseInt(parts[1]));
        }
    });
    return assignments;
}