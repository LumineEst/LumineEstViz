/**
* ====================================================================
* ScheduleTab IIFE Module
*
* Encapsulates all logic for rendering and animating the Schedule
* Gantt chart visualization.
* ====================================================================
*/
const ScheduleTab = (function () {
    // Info panel visibility state
    let infoPanelVisible = false;

    /**
     * @tab Schedule
     * Draws the animated Gantt chart for the production schedule.
     * This is the main public method exposed by the IIFE.
     */
    function draw() {
        // --- INITIAL SETUP ---
        // Filter state for toggling product visibility on the chart.
        let activeProductFilters = {
            1: true, // Super (modelId 1)
            2: true, // Ultra (modelId 2)
            3: true // Mega (modelId 3)
        };
        
        // The default duration of the animated view window in simulation minutes.
        const VIEW_WINDOW_MINS = 10;
        const SIM_TIME_ACCELERATION = 60; // Run the simulation 60x faster than real time at 1x speed.
        const END_PLAYOUT_BUFFER_MINUTES = 0.1; // Allow 6 seconds of extra playback so the last bar clears the marker.
        const COMPLETION_EPSILON = 1e-4; // Cushion for floating point comparisons when counting completions.
        
        // State for managing the view's zoom level and pause state.
        let zoomLevel = 1.0; // 1.0 = normal, >1 = zoom in, <1 = zoom out.
        let isPaused = false;
        let currentViewWindow = VIEW_WINDOW_MINS; // The current view window, adjusted by zoom.

        animationState.schedule.isManuallyPaused = false;

        // Info panel visibility
        const isInfoVisible = infoPanelVisible;

        // Root element for CSS custom properties
        const root = document.documentElement;

        // --- SVG & DATA PREPARATION ---
        // Select the SVG container and clear any previous renderings.
        const svg = d3.select("#schedule-panel");
        svg.selectAll("*").remove();
        svg.selectAll(".workstation-schedule-label").remove(); // Clear any lingering labels.

        // Info panel group
        const infoGroup = svg.append("g")
            .attr("id", "info-panel")
            .style("display", isInfoVisible ? "block" : "none")
            .style("pointer-events", isInfoVisible ? "auto" : "none");

        // Helper to toggle interactions when the info panel is shown/hidden.
        function updateInfoPanelInteraction() {
            if (infoPanelVisible) {
                // Show panel and bring to front
                infoGroup.style("display", "block").style("pointer-events", "none");
                // Set pointer-events auto on interactive elements
                playPauseBtn.style("pointer-events", "auto");
                resetBtn.style("pointer-events", "auto");
                filterResetBtn.style("pointer-events", "auto");
                exportBtn.style("pointer-events", "auto");
                zoomInBtn.style("pointer-events", "auto");
                zoomOutBtn.style("pointer-events", "auto");
                superFilterGroup.style("pointer-events", "auto");
                ultraFilterGroup.style("pointer-events", "auto");
                megaFilterGroup.style("pointer-events", "auto");
                sliderGroup.style("pointer-events", "auto");
                if (typeof infoGroup.raise === 'function') infoGroup.raise();
            } else {
                // Hide panel
                infoGroup.style("display", "none").style("pointer-events", "none");
            }
        }

        // Run the Gantt simulation to get task data.
        const simulationResult = runGanttSimulation();
        const { clientWidth: containerWidth, clientHeight: containerHeight } = document.getElementById('svg-container');
        
        // expose it globally
        ScheduleTab.containerHeight = containerHeight;

        // If the simulation returns no tasks, display a message and exit.
        if (!simulationResult || simulationResult.tasks.length === 0) {
            svg.append("text").attr("x", containerWidth / 2).attr("y", containerHeight / 2).attr("text-anchor", "middle").attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
                .text("No data to display. Check configuration or inputs.");
            return;
        }
        const { tasks } = simulationResult;
        const opHours = parseFloat(opHoursInput.value);
        const MODEL_LABELS = { 1: 'Super', 2: 'Ultra', 3: 'Mega' };
        const FINAL_TASK_ID = 31;
        const completionRecords = tasks.filter(t => t.taskId === FINAL_TASK_ID).map(t => t.endTime).sort((a, b) => a - b);
        let averageCycleTimeMinutes = null;
        if (completionRecords.length >= 2) {
            let intervalSum = 0;
            for (let i = 1; i < completionRecords.length; i += 1) {
                intervalSum += (completionRecords[i] - completionRecords[i - 1]);
            }
            averageCycleTimeMinutes = intervalSum / (completionRecords.length - 1);
        }
        const unitSpans = new Map();
        tasks.forEach(task => {
            if (!task || !task.uniqueId) return;
            if (!unitSpans.has(task.uniqueId)) {
                unitSpans.set(task.uniqueId, {
                    modelId: task.modelId,
                    start: task.startTime,
                    end: task.endTime
                });
            } else {
                const span = unitSpans.get(task.uniqueId);
                span.start = Math.min(span.start, task.startTime);
                span.end = Math.max(span.end, task.endTime);
            }
        });
        const processTimesByModel = new Map();
        unitSpans.forEach(span => {
            if (!span) return;
            const duration = span.end - span.start;
            if (!processTimesByModel.has(span.modelId)) {
                processTimesByModel.set(span.modelId, []);
            }
            processTimesByModel.get(span.modelId).push(duration);
        });
        const averageProcessTimes = new Map();
        processTimesByModel.forEach((durations, modelId) => {
            if (!durations || durations.length === 0) return;
            const total = durations.reduce((sum, value) => sum + value, 0);
            averageProcessTimes.set(modelId, total / durations.length);
        });

        // Calculate quality yield for defective products
        const opInputs = { dailyDemand: parseInt(dailyDemandInput.value, 10), opHours: parseFloat(opHoursInput.value), numEmployees: parseInt(numEmployeesInput.value, 10) };
        const finInputs = { laborCost: parseFloat(laborCostInput.value) };
        const results = calculateMetrics(opInputs, finInputs);
        const qualityYield = results.qualityYield;

        // Generate defect status for all products using the same random sequence
        let defectStatus;
        if (!window.sharedDefectData || window.sharedDefectData.dailyDemand !== opInputs.dailyDemand || window.sharedDefectData.qualityYield !== qualityYield) {
            defectStatus = [];
            for (let i = 0; i < opInputs.dailyDemand; i++) {
                defectStatus.push(Math.random() > qualityYield);
            }
            window.sharedDefectData = { dailyDemand: opInputs.dailyDemand, qualityYield, defectStatus };
        } else {
            defectStatus = window.sharedDefectData.defectStatus;
        }

        // Determine defective products
        const defectiveProducts = new Map();
        unitSpans.forEach((span, uniqueId) => {
            const index = parseInt(uniqueId.split('-')[1]);
            defectiveProducts.set(uniqueId, defectStatus[index]);
        });
        const formatMinutesToClock = (minutes) => {
            if (!isFinite(minutes) || minutes < 0) return "N/A";
            const totalSeconds = Math.max(0, Math.round(minutes * 60));
            const hours = Math.floor(totalSeconds / 3600);
            const minutesPart = Math.floor((totalSeconds % 3600) / 60);
            const secondsPart = totalSeconds % 60;
            return `${hours.toString().padStart(2, '0')}:${minutesPart.toString().padStart(2, '0')}:${secondsPart.toString().padStart(2, '0')}`;
        };

        // Define chart margins and dimensions.
        const margin = { top: 40, right: 20, bottom: 40, left: 100 };
        const width = containerWidth - margin.left - margin.right;
        const height = containerHeight - margin.top - margin.bottom;

        // expose it globally
        ScheduleTab.margin = { top: margin.top, right: margin.right, bottom: margin.bottom, left: margin.left };
        ScheduleTab.width = width;
        ScheduleTab.height = height;

        // Create the main chart group, translated by the margin.
        const chart = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);
        const controlsY = (height + margin.top) * 0.95;
        const controlsStartX = margin.left;
        const controlsEndX = width - margin.right;

        // Add box around product and filter controls
        const boxX = controlsEndX - 156 - 10;
        const boxY = controlsY - 113;
        const boxWidth = (controlsEndX - 70) - (controlsEndX - 156) + 40;
        const boxHeight = (controlsY - 20) - (controlsY - 80) + 60;
        infoGroup.append("rect")
            .attr("x", boxX)
            .attr("y", boxY)
            .attr("width", boxWidth)
            .attr("height", boxHeight)
            .attr("fill", getComputedStyle(root).getPropertyValue('--white'))
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent'))
            .attr("rx", 5)
            .style("pointer-events", "auto");

        // --- UI CONTROLS & DISPLAYS ---
        // Timer display for the simulation clock.
        const clockGroup = infoGroup.append("g")
            .attr("transform", `translate(${controlsStartX + 10}, ${controlsY - 33})`);

        // Background rect
        clockGroup.append("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", 85)
            .attr("height", 18)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("rx", 3);
        
        // Time text
        const clockDisplay = clockGroup.append("text")
            .attr("id", "sim-clock-display")
            .attr("x", 12)
            .attr("y", 14)
            .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
            .style("font-size", "14px")
            .style("font-family", "monospace")
            .text("00:00:00");
        
        // Production counters for each model type.
        const superCounter = infoGroup.append("text")
            .attr("id", "super-counter")
            .attr("x", controlsEndX - 156)
            .attr("y", boxY + 40)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .style("font-size", "16px")
            .text("Super: 0");
        const ultraCounter = infoGroup.append("text")
            .attr("id", "ultra-counter")
            .attr("x", controlsEndX - 156)
            .attr("y", boxY + 60)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .style("font-size", "16px")
            .text("Ultra: 0");
        const megaCounter = infoGroup.append("text")
            .attr("id", "mega-counter")
            .attr("x", controlsEndX - 156)
            .attr("y", boxY + 80)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .style("font-size", "16px")
            .text("Mega: 0");

        // Section Title
        infoGroup.append("text")
            .attr("class", "product-title")
            .attr("x", controlsEndX - 154)
            .attr("y", boxY + 20)
            .attr("text-anchor", "start")
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .style("font-size", "14px")
            .style("font-weight", "bold")
            .text("Product");

        // Product type filter controls (checkboxes).
        // Super Filter
        const superFilterGroup = infoGroup.append("g")
            .attr("class", "super-filter")
            .attr("transform", `translate(${controlsEndX - 70}, ${boxY + 28})`)
            .style("cursor", "pointer");
        superFilterGroup.append("rect")
            .attr("width", 12)
            .attr("height", 12)
            .attr("fill", activeProductFilters[1] ? getComputedStyle(root).getPropertyValue('--super-color').trim() : getComputedStyle(root).getPropertyValue('--white').trim())
            .attr("stroke", getComputedStyle(root).getPropertyValue('--super-color').trim())
            .attr("stroke-width", 2)
            .attr("rx", 2);

        // Checkmark
        if (activeProductFilters[1]) {
            superFilterGroup.append("text")
                .attr("x", 6)
                .attr("y", 9)
                .attr("text-anchor", "middle")
                .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
                .style("font-size", "10px")
                .style("font-weight", "bold")
                .text("✓");
        }

        // Ultra Filter
        const ultraFilterGroup = infoGroup.append("g")
            .attr("class", "ultra-filter")
            .attr("transform", `translate(${controlsEndX - 70}, ${boxY + 48})`)
            .style("cursor", "pointer");
        ultraFilterGroup.append("rect")
            .attr("width", 12)
            .attr("height", 12)
            .attr("fill", activeProductFilters[2] ? getComputedStyle(root).getPropertyValue('--ultra-color').trim() : getComputedStyle(root).getPropertyValue('--white').trim())
            .attr("stroke", getComputedStyle(root).getPropertyValue('--ultra-color').trim())
            .attr("stroke-width", 2)
            .attr("rx", 2);
        
        // Checkmark
        if (activeProductFilters[2]) {
            ultraFilterGroup.append("text")
                .attr("x", 6)
                .attr("y", 9)
                .attr("text-anchor", "middle")
                .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
                .style("font-size", "10px")
                .style("font-weight", "bold")
                .text("✓");
        }
        
        // Mega Filter
        const megaFilterGroup = infoGroup.append("g")
            .attr("class", "mega-filter")
            .attr("transform", `translate(${controlsEndX - 70}, ${boxY + 68})`)
            .style("cursor", "pointer");
        megaFilterGroup.append("rect")
            .attr("width", 12)
            .attr("height", 12)
            .attr("fill", activeProductFilters[3] ? getComputedStyle(root).getPropertyValue('--mega-color').trim() : getComputedStyle(root).getPropertyValue('--white').trim())
            .attr("stroke", getComputedStyle(root).getPropertyValue('--mega-color').trim())
            .attr("stroke-width", 2)
            .attr("rx", 2);
        
        // Checkmark
        if (activeProductFilters[3]) {
            megaFilterGroup.append("text")
                .attr("x", 6)
                .attr("y", 9)
                .attr("text-anchor", "middle")
                .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
                .style("font-size", "10px")
                .style("font-weight", "bold")
                .text("✓");
        }

        // Section Title
        infoGroup.append("text")
            .attr("class", "filter-title")
            .attr("x", controlsEndX - 80)
            .attr("y", boxY + 20)
            .attr("text-anchor", "start")
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .style("font-size", "14px")
            .style("font-weight", "bold")
            .text("Filter");

        // Animation control buttons (Play/Pause, Reset).
        const controlsGroup = infoGroup.append("g")
            .attr("transform", `translate(${controlsStartX + 10}, ${controlsY - 10})`);

        // Play/Pause button
        const playPauseBtn = controlsGroup.append("g")
            .attr("class", "play-pause-btn")
            .style("cursor", "pointer");
        playPauseBtn.append("rect")
            .attr("width", 40)
            .attr("height", 18)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("rx", 3);
        const playPauseIcon = playPauseBtn.append("text")
            .attr("x", 20)
            .attr("y", 13)
            .attr("text-anchor", "middle")
            .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
            .style("font-size", "14px")
            .text("⏸");
        
        // Reset button
        const resetBtn = controlsGroup.append("g")
            .attr("class", "reset-btn")
            .attr("transform", "translate(45, 0)")
            .style("cursor", "pointer");
        resetBtn.append("rect")
            .attr("width", 40)
            .attr("height", 18)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("rx", 3);
        resetBtn.append("text")
            .attr("x", 20)
            .attr("y", 13)
            .attr("text-anchor", "middle")
            .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
            .style("font-size", "13px")
            .text("⟳");

        // Filter reset button.
        const filterResetBtn = controlsGroup.append("g")
            .attr("class", "filter-reset-btn")
            .attr("transform", `translate(${controlsEndX - 265}, -7)`)
            .style("cursor", "pointer");
        filterResetBtn.append("rect")
            .attr("width", 100)
            .attr("height", 18)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("rx", 3);
        filterResetBtn.append("text")
            .attr("x", 50)
            .attr("y", 12)
            .attr("text-anchor", "middle")
            .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
            .style("font-size", "10px")
            .text("RESET");

        // Export button.
        const exportBtn = controlsGroup.append("g")
            .attr("class", "export-btn")
            .attr("transform", "translate(0, -46)")
            .style("cursor", "pointer");
        exportBtn.append("rect")
            .attr("width", 100)
            .attr("height", 18)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("rx", 3);
        exportBtn.append("text")
            .attr("x", 50)
            .attr("y", 12)
            .attr("text-anchor", "middle")
            .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
            .style("font-size", "10px")
            .text("EXPORT");
        
        // Zoom controls.
        const zoomGroup = infoGroup.append("g")
            .attr("transform", `translate(${controlsStartX + 100}, ${controlsY - 10})`);
        
        // Zoom In button
        const zoomInBtn = zoomGroup.append("g")
            .attr("class", "zoom-in-btn")
            .style("cursor", "pointer");
        zoomInBtn.append("rect")
            .attr("width", 40)
            .attr("height", 18)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("rx", 3);
        zoomInBtn.append("text")
            .attr("x", 20)
            .attr("y", 13)
            .attr("text-anchor", "middle")
            .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
            .style("font-size", "14px")
            .text("+");
        
        // Zoom Out button
        const zoomOutBtn = zoomGroup.append("g")
            .attr("class", "zoom-out-btn")
            .attr("transform", "translate(45, 0)")
            .style("cursor", "pointer");
        zoomOutBtn.append("rect")
            .attr("width", 40)
            .attr("height", 18)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("rx", 3);
        zoomOutBtn.append("text")
            .attr("x", 20)
            .attr("y", 13)
            .attr("text-anchor", "middle")
            .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
            .style("font-size", "14px")
            .text("-");

        // --- CONTROL EVENT LISTENERS ---
        // Play/Pause button functionality.
        playPauseBtn.on("click", function () {
            isPaused = !isPaused;
            animationState.schedule.isPaused = isPaused;
            animationState.schedule.isManuallyPaused = isPaused;
            playPauseIcon.text(isPaused ? "▶" : "⏸"); // Toggle icon.
            // If resuming, restart the animation loop if it's not already running.
            if (!isPaused && !animationState.schedule.isRunning) {
                animationState.schedule.isRunning = true;
                animationState.schedule.lastFrameTime = performance.now();
                animationState.schedule.frameId = requestAnimationFrame(animationLoop);
            }
        });
        // Reset button functionality.
        resetBtn.on("click", function () {
            animationState.schedule.totalSimTimeMins = 0; // Reset time to zero.
            animationState.schedule.lastFrameTime = performance.now();
            isPaused = false;
            animationState.schedule.isPaused = false;
            animationState.schedule.isManuallyPaused = false;
            playPauseIcon.text("⏸");
            clockDisplay.text("00:00:00");
            // Restart animation loop if it was stopped.
            if (!animationState.schedule.isRunning) {
                animationState.schedule.isRunning = true;
                animationState.schedule.frameId = requestAnimationFrame(animationLoop);
            }
        });
        // Zoom In/Out functionality.
        zoomInBtn.on("click", function () {
            zoomLevel = Math.min(zoomLevel * 1.5, 4.0); // Increase zoom, max 4x.
            currentViewWindow = VIEW_WINDOW_MINS / zoomLevel; // Decrease view window duration.
        });
        zoomOutBtn.on("click", function () {
            zoomLevel = Math.max(zoomLevel / 1.5, 0.25); // Decrease zoom, min 0.25x.
            currentViewWindow = VIEW_WINDOW_MINS / zoomLevel; // Increase view window duration.
        });
        // Filter reset functionality.
        filterResetBtn.on("click", function () {
            // Reset all product filters to active.
            activeProductFilters[1] = true;
            activeProductFilters[2] = true;
            activeProductFilters[3] = true;
            updateFilterUI(); // Update checkbox visuals.
            updateTaskVisibility(); // Update task bar visibility.
        });

        // Export functionality.
        exportBtn.on("click", function () {
            // Generate build sequence data.
            const sortedUnits = Array.from(unitSpans.entries()).sort((a, b) => a[1].start - b[1].start);
            let csv = "Sequence,Model,Enter Time,Exit Time\n";
            sortedUnits.forEach(([uniqueId, span], index) => {
                const sequence = index + 1; // sequential order based on enter time
                const modelName = MODEL_LABELS[span.modelId] || `Model ${span.modelId}`;
                const enterTime = formatMinutesToClock(span.start);
                const exitTime = formatMinutesToClock(span.end);
                csv += `${sequence},${modelName},${enterTime},${exitTime}\n`;
            });
            // Download the CSV.
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'build_sequence.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
        // Individual product filter functionality.
        superFilterGroup.on("click", function () {
            activeProductFilters[1] = !activeProductFilters[1];
            updateFilterUI();
            updateTaskVisibility();
        });
        ultraFilterGroup.on("click", function () {
            activeProductFilters[2] = !activeProductFilters[2];
            updateFilterUI();
            updateTaskVisibility();
        });
        megaFilterGroup.on("click", function () {
            activeProductFilters[3] = !activeProductFilters[3];
            updateFilterUI();
            updateTaskVisibility();
        });

        // --- FILTER HELPER FUNCTIONS ---
        /**
         * Updates the visual state of the filter checkboxes.
         */
        function updateFilterUI() {
            // Update Super filter checkbox and checkmark.
            superFilterGroup.select("rect")
                .attr("fill", activeProductFilters[1] ? getComputedStyle(root).getPropertyValue('--super-color').trim() : getComputedStyle(root).getPropertyValue('--white').trim());
            superFilterGroup.selectAll("text").remove();
            if (activeProductFilters[1]) { superFilterGroup.append("text")
                .attr("x", 6)
                .attr("y", 9)
                .attr("text-anchor", "middle")
                .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
                .style("font-size", "10px")
                .style("font-weight", "bold")
                .text("✓"); }
            // Update Ultra filter checkbox and checkmark.
            ultraFilterGroup.select("rect")
                .attr("fill", activeProductFilters[2] ? getComputedStyle(root).getPropertyValue('--ultra-color').trim() : getComputedStyle(root).getPropertyValue('--white').trim());
            ultraFilterGroup.selectAll("text").remove();
            if (activeProductFilters[2]) { ultraFilterGroup.append("text")
                .attr("x", 6)
                .attr("y", 9)
                .attr("text-anchor", "middle")
                .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
                .style("font-size", "10px")
                .style("font-weight", "bold")
                .text("✓"); }
            // Update Mega filter checkbox and checkmark.
            megaFilterGroup.select("rect")
                .attr("fill", activeProductFilters[3] ? getComputedStyle(root).getPropertyValue('--mega-color').trim() : getComputedStyle(root).getPropertyValue('--white').trim());
            megaFilterGroup.selectAll("text").remove();
            if (activeProductFilters[3]) { megaFilterGroup.append("text")
                .attr("x", 6)
                .attr("y", 9)
                .attr("text-anchor", "middle")
                .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
                .style("font-size", "10px")
                .style("font-weight", "bold")
                .text("✓"); }
        }

        /**
         * Animates the visibility of task bars based on the active filters.
         */
        function updateTaskVisibility() {
            // Select bars that should be visible.
            const visibleBars = contentGroup.selectAll(".bar")
                .filter(d => activeProductFilters[d.modelId]);
            // Select bars that should be hidden.
            const hiddenBars = contentGroup.selectAll(".bar")
                .filter(d => !activeProductFilters[d.modelId]);
            // Animate visible bars into view.
            visibleBars.style("display", "block").transition().duration(300).ease(d3.easeQuadOut)
                .style("opacity", 0.9)
                .style("transform", "scale(1)");
            // Animate hidden bars out of view.
            hiddenBars.transition().duration(300).ease(d3.easeQuadIn)
                .style("opacity", 0.0)
                .style("transform", "scale(0.95)")
                .on("end", function () { d3.select(this)
                    .style("display", "none"); });
        }

        // Throughput metrics display (responsive to screen size)
        const metricsPadding = Math.max(8, Math.min(16, containerWidth * 0.01));

        // Responsive font sizes
        const fontSize = Math.round(Math.max(11, Math.min(18, containerWidth * 0.0115)));
        const rowLineHeight = Math.round(fontSize * 1.2);

        // Responsive box size (clamped)
        const metricsBoxWidth = fontSize * 15;
        const metricsBoxHeight = fontSize * 4 + metricsPadding;

        // Position the metrics box a fixed 85px to the right of controlsStartX.
        const rectX = controlsStartX 
                    + +playPauseBtn.select("rect").attr("width")
                    + 10
                    + +resetBtn.select("rect").attr("width")
                    + 10
                    + +zoomInBtn.select("rect").attr("width")
                    + 10
                    + +zoomOutBtn.select("rect").attr("width");

        // Position Y near controls
        const metricsBaseY = controlsY - metricsBoxHeight + 7;

        // Draw background box (positioned using rectX)
        infoGroup.append("rect")
            .attr("class", "throughput-metrics-box")
            .attr("x", rectX)
            .attr("y", metricsBaseY)
            .attr("width", metricsBoxWidth)
            .attr("height", metricsBoxHeight)
            .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("rx", Math.max(4, Math.round(metricsBoxWidth * 0.02)))
            .style("pointer-events", "auto");

        // Cycle time title / value (text placed inside the box with padding)
        const textBaseX = rectX + 4; // small left inset inside the box
        infoGroup.append("text")
            .attr("class", "cycle-time-label")
            .attr("x", textBaseX)
            .attr("y", metricsBaseY + fontSize)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .style("font-size", `${fontSize}px`)
            .text(`Cycle Time: ${averageCycleTimeMinutes !== null ? formatMinutesToClock(averageCycleTimeMinutes) : "N/A"}`);

        // Process times (one row per model) with responsive spacing
        const processModels = [1, 2, 3];
        processModels.forEach((modelId, index) => {
            const label = MODEL_LABELS[modelId] || `Model ${modelId}`;
            const value = averageProcessTimes.has(modelId) ? formatMinutesToClock(averageProcessTimes.get(modelId)) : "N/A";
            infoGroup.append("text")
            .attr("class", `process-time-label-${modelId}`)
            .attr("x", textBaseX)
            .attr("y", metricsBaseY + fontSize + (index + 1) * rowLineHeight)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .style("font-size", `${fontSize}px`)
            .text(`Process Time (${label}): ${value}`);
        });

        // --- CHART & ANIMATION SETUP ---
        // Timeline scrubbing: click on the chart to jump to a specific time.
        // Updated to perform a fast animated move forward so clicking is visually obvious.
        let scrubWatcherFrame = null;
        chart.append("rect")
            .attr("class", "timeline-scrubber")
            .attr("width", width)
            .attr("height", height)
            .attr("fill", "transparent")
            .style("cursor", "crosshair")
            .on("click", function (event) {
            const [mouseX] = d3.pointer(event);
            const clickedTime = xScale.invert(mouseX); // Convert pixel position to simulation time.
            // Clamp to valid bounds.
            const targetTime = Math.max(0, Math.min(totalSimDurationMinutes, clickedTime));
            const currentTime = animationState.schedule ? animationState.schedule.totalSimTimeMins : 0;

            // Quick no-op if already essentially at target.
            if (Math.abs(targetTime - currentTime) < 1e-3) return;

            // If clicking backward, keep original instantaneous behavior (optional).
            if (targetTime < currentTime) {
                animationState.schedule.totalSimTimeMins = targetTime;
                const h = String(Math.floor(targetTime / 60)).padStart(2, '0');
                const m = String(Math.floor(targetTime % 60)).padStart(2, '0');
                const s = String(Math.floor((targetTime % 1) * 60)).padStart(2, '0');
                clockDisplay.text(`${h}:${m}:${s}`);
                return;
            }

            // Cancel any existing scrub watcher.
            if (scrubWatcherFrame) {
                cancelAnimationFrame(scrubWatcherFrame);
                scrubWatcherFrame = null;
            }

            // Ensure the main animation loop is running so visuals update while we fast-forward.
            if (!animationState.schedule.isRunning) {
                animationState.schedule.isRunning = true;
                animationState.schedule.lastFrameTime = performance.now();
                animationState.schedule.frameId = requestAnimationFrame(animationLoop);
            }
            // Ensure not paused so the loop will advance.
            const wasPaused = isPaused;
            isPaused = false;
            animationState.schedule.isPaused = false;

            // Temporarily increase speed to create a fast but clear movement.
            const prevSpeed = animationState.speedMultiplier || 1.0;
            const fastSpeed = Math.min(20.0, Math.max(prevSpeed, 10.0));
            animationState.speedMultiplier = fastSpeed;

            // Watcher drives completion detection. When reached, restore speed (and snap exactly).
            function scrubWatcher() {
                const nowSim = animationState.schedule.totalSimTimeMins;
                // Update clock display in real time during scrub to make motion obvious.
                const h = String(Math.floor(nowSim / 60)).padStart(2, '0');
                const m = String(Math.floor(nowSim % 60)).padStart(2, '0');
                const s = String(Math.floor((nowSim % 1) * 60)).padStart(2, '0');
                clockDisplay.text(`${h}:${m}:${s}`);

                if (nowSim >= (targetTime - COMPLETION_EPSILON)) {
                // Snap exactly to target and restore previous speed.
                animationState.schedule.totalSimTimeMins = targetTime;
                animationState.speedMultiplier = prevSpeed;
                const fh = String(Math.floor(targetTime / 60)).padStart(2, '0');
                const fm = String(Math.floor(targetTime % 60)).padStart(2, '0');
                const fs = String(Math.floor((targetTime % 1) * 60)).padStart(2, '0');
                clockDisplay.text(`${fh}:${fm}:${fs}`);
                isPaused = wasPaused;
                animationState.schedule.isPaused = wasPaused;
                animationState.schedule.isManuallyPaused = wasPaused;
                if (scrubWatcherFrame) {
                    cancelAnimationFrame(scrubWatcherFrame);
                    scrubWatcherFrame = null;
                }
                return;
                }
                scrubWatcherFrame = requestAnimationFrame(scrubWatcher);
            }

            // Start the watcher loop.
            scrubWatcherFrame = requestAnimationFrame(scrubWatcher);
            });
        
        // Speed slider.
        const sliderWidth = Math.max(40, Math.min(80, containerWidth * 0.12));
        const sliderGroup = infoGroup.append("g")
            .attr("transform", `translate(${controlsStartX + 103}, ${controlsY - 20})`);
        
        // Map speed value to pixel position
        const speedScale = d3.scaleLinear()
            .domain([0.1, 8.0])
            .range([0, sliderWidth])
            .clamp(true);
        
        // Label
        sliderGroup.append("text")
            .attr("x", sliderWidth / 2)
            .attr("y", -8)
            .attr("text-anchor", "middle")
            .style("font-size", "12px")
            .style("font-weight", "bold")
            .style("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .text("Speed");
        
        // Track
        sliderGroup.append("line")
            .attr("class", "track")
            .attr("x1", 0)
            .attr("x2", sliderWidth)
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("stroke-width", 3)
            .attr("stroke-linecap", "round");
        
        // Handle
        sliderGroup.append("circle")
            .attr("id", "d3-schedule-slider-handle")
            .attr("class", "handle")
            .attr("r", 6)
            .attr("fill", getComputedStyle(root).getPropertyValue('--secondary1').trim())
            .attr("stroke", getComputedStyle(root).getPropertyValue('--white').trim())
            .attr("stroke-width", 2)
            .attr("cx", speedScale(animationState.speedMultiplier));
        
        // Interaction area
        const speedInteractionArea = sliderGroup.append("rect")
            .attr("x", -10)
            .attr("width", sliderWidth + 20)
            .attr("y", -10)
            .attr("height", 20)
            .style("fill", "transparent")
            .style("cursor", "grab")
            .style("touch-action", "none");
        
        // Speed slider event listeners (drag, click, wheel).
        speedInteractionArea
            .on("mousedown", function () { d3.select(this)
                .style("cursor", "grabbing"); })
            .on("mouseup", function () { d3.select(this)
                .style("cursor", "grab"); })
            .on("click", (event) => {
                const localX = Math.max(0, Math.min(sliderWidth, d3.pointer(event, sliderGroup.node())[0]));
                animationState.speedMultiplier = speedScale.invert(localX);
                sliderGroup.select(".handle")
                    .attr("cx", speedScale(animationState.speedMultiplier));
            })
            .call(d3.drag().on("drag", (event) => {
                const localX = Math.max(0, Math.min(sliderWidth, event.x));
                animationState.speedMultiplier = speedScale.invert(localX);
                sliderGroup.select(".handle")
                    .attr("cx", speedScale(animationState.speedMultiplier));
            }));
        
        // Add wheel support for fine-tuning speed.
        speedInteractionArea.on("wheel", function (event) {
            event.preventDefault();
            const delta = event.deltaY > 0 ? -0.1 : 0.1;
            animationState.speedMultiplier = Math.max(0.1, Math.min(8.0, animationState.speedMultiplier + delta));
            d3.select("#d3-schedule-slider-handle").attr("cx", speedScale(animationState.speedMultiplier));
        });
        
        // --- CHART DRAWING ---
        // Main content group for chart elements (bars, lines). This group is translated by the sidebar scroll.
        const contentGroup = chart.append("g").attr("class", "schedule-content-group");

        const yOffset = document.getElementById('svg-container').getBoundingClientRect().top + margin.top;
        // Map task IDs to their vertical position based on the sidebar layout.
        const elementGeometry = new Map();
        document.querySelectorAll('.element-row').forEach(elRow => {
            const taskId = parseInt(elRow.dataset.taskId);
            const rect = elRow.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            const barHeight = rect.height * 0.8;
            const barY = (centerY - barHeight / 2) - yOffset;
            elementGeometry.set(taskId, { y: barY, height: barHeight });
        });

        // Add workstation labels and separator lines.
        // Add a clipping region so only chart-area elements are visible.
        const clipId = "workstation-schedule-clip";

        // Create defs/clipPath only if not present to avoid duplicates on redraw.
        let defs = chart.select('defs');
        if (defs.empty()) defs = chart.append('defs');

        let clipPath = defs.select(`#${clipId}`);
        if (clipPath.empty()) {
            clipPath = defs.append("clipPath").attr("id", clipId);
            // Create a rect we can move as the sidebar scrolls so the mask follows the viewport.
            // Start the rect at -margin.top so the chart top is included, and make the height large enough
            // to cover the full chart area including margins.
            clipPath.append("rect")
                .attr("x", -margin.left)
                .attr("y", -margin.top)
                .attr("width", width + margin.left + margin.right)
                .attr("height", (height + margin.top + margin.bottom) * 0.93);
        }

        // Cache the rect selection for updates
        const clipRect = clipPath.select('rect');

        // Apply the clip to the content group so anything outside the chart area is hidden.
        contentGroup.attr("clip-path", `url(#${clipId})`);

        // Update the clip rect position when the workstation list scrolls so the mask moves with scrolling.
        // Assumes a `workstationList` element exists in scope (used elsewhere in this module).
        function updateClipPosition() {
            try {
            const scrollTop = workstationList ? workstationList.scrollTop : 0;
            // Adjust y so the clip rect accounts for the top margin; as the list scrolls down (positive scrollTop)
            // we offset the clip rect accordingly so the chart top is not clipped.
            clipRect.attr("y", -margin.top + scrollTop);
            } catch (e) { /* no-op if workstationList not available yet */ }
        }
        
        // Attach listener and set initial position.
        if (typeof workstationList !== "undefined" && workstationList) {
            workstationList.addEventListener("scroll", updateClipPosition, { passive: true });
        }
        updateClipPosition();

        // Draw workstation separator lines and labels (they will be clipped to the chart area).
        const separatorLineYs = []; // store separator positions for later spacing calculations
        const titles = Array.from(document.querySelectorAll('.workstation-title'));
        titles.forEach(title => {
            const rect = title.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            const lineY = centerY - yOffset;

            // store id and geometry for later use
            const workstationMatch = title.textContent.match(/\d+/);
            separatorLineYs.push({
            id: workstationMatch ? workstationMatch[0] : null,
            lineY,
            rectHeight: rect.height
            });

            // Separator line
            contentGroup.append("line")
            .attr("x1", -margin.left)
            .attr("x2", width + margin.right)
            .attr("y1", lineY)
            .attr("y2", lineY)
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("stroke-width", 2)
            .attr("stroke-opacity", 0.3);

            // Label
            if (workstationMatch) {
            contentGroup.append("text")
                .attr("class", "workstation-schedule-label")
                .attr("x", -10)
                .attr("y", lineY + 2)
                .attr("text-anchor", "end")
                .attr("dominant-baseline", "hanging")
                .style("font-size", "14px")
                .style("font-weight", "bold")
                .style("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
                .text(`WS ${workstationMatch[0]}`);
            }
        });

        // Add an extra separator line underneath the last workstation so the final row is bounded.
        if (titles.length > 0) {
            const lastTitle = titles[titles.length - 1];
            const lastRect = lastTitle.getBoundingClientRect();

            // Try to determine the workstation id from the title text (e.g. "WS 3")
            const wsMatch = lastTitle.textContent.match(/\d+/);
            const wsId = wsMatch ? wsMatch[0] : null;

            // Find element rows belonging to that workstation. Prefer explicit data attributes,
            // otherwise fall back to spatial filtering (rows below the title).
            const allRows = Array.from(document.querySelectorAll('.element-row'));
            const candidateRows = allRows.filter(el => {
            const ds = el.dataset || {};
            // check common dataset fields that might indicate workstation membership
            if (wsId && (String(ds.workstationId) === String(wsId) || String(ds.workstation) === String(wsId))) {
                return true;
            }
            // fallback: spatially consider rows that start below the title
            const r = el.getBoundingClientRect();
            return r.top >= (lastRect.top + lastRect.height * 0.5);
            });

            // Compute the bottom-most pixel of the last workstation's element rows.
            let bottomPixel;
            if (candidateRows.length > 0) {
            bottomPixel = candidateRows.reduce((maxBottom, el) => {
                const b = el.getBoundingClientRect().bottom;
                return Math.max(maxBottom, b);
            }, -Infinity);
            } else {
            // no element rows found -> fall back to title bottom
            bottomPixel = lastRect.bottom;
            }

            // Add a small padding so the separator is placed after the last element, not exactly overlapping.
            const PADDING_PX = 23;
            const bottomLineY = (bottomPixel + PADDING_PX) - yOffset;

            // push a separator entry without an id so spacing calculations can use it as the 'next' separator
            separatorLineYs.push({
            id: null,
            lineY: bottomLineY,
            rectHeight: lastRect.height
            });

            contentGroup.append("line")
            .attr("x1", -margin.left)
            .attr("x2", width + margin.right)
            .attr("y1", bottomLineY)
            .attr("y2", bottomLineY)
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("stroke-width", 2)
            .attr("stroke-opacity", 0.3);
        }

        // D3 scales for mapping data to visual properties.
        const xScale = d3.scaleLinear().range([0, width]); // Time -> X position.
        const modelColors = d3.scaleOrdinal().domain([1, 2, 3]).range([getComputedStyle(root).getPropertyValue('--super-color').trim(), getComputedStyle(root).getPropertyValue('--ultra-color').trim(), getComputedStyle(root).getPropertyValue('--mega-color').trim()]); // Model ID -> color.
        
        // --- PERFORMANCE OVERLAYS ---
        // Add utilization bars and bottleneck highlighting.
        try {
            const metrics = calculateMetrics({ dailyDemand: +dailyDemandInput.value, opHours: +opHoursInput.value, numEmployees: +numEmployeesInput.value }, { laborCost: +laborCostInput.value });
            if (metrics && Array.isArray(metrics.workstations) && metrics.workstations.length > 0) {

            // Find the bottleneck workstations (longest cycle time, i.e., lowest idle time).
            const maxCycleTime = Math.max(...metrics.workstations.map(ws => ws.cycleTime || 0));
            document.querySelectorAll('.workstation-title').forEach(title => {
                const wsMatch = title.textContent && title.textContent.match(/\d+/);
                if (!wsMatch) return;
                const wsId = wsMatch[0];
                const wsInfo = metrics.workstations.find(w => String(w.id) === String(wsId));
                if (!wsInfo) return;
                const rect = title.getBoundingClientRect();
                const lineY = (rect.top + rect.height / 2) - yOffset;

                // Highlight the bottleneck row using spacing between separator lines.
                if (wsInfo.cycleTime === maxCycleTime) {
                // Find the stored separator entry for this workstation to compute spacing
                const sepIndex = separatorLineYs.findIndex(s => String(s.id) === String(wsId));
                let highlightY = lineY;
                let highlightHeight = rect.height; // fallback
                if (sepIndex !== -1) {
                    const current = separatorLineYs[sepIndex];
                    const next = separatorLineYs[sepIndex + 1];
                    const prev = separatorLineYs[sepIndex - 1];
                    // Determine spacing using next or previous separator; fall back to stored rectHeight
                    let spacing;
                    if (next) {
                    spacing = next.lineY - current.lineY;
                    } else if (prev) {
                    spacing = current.lineY - prev.lineY;
                    } else {
                    spacing = current.rectHeight;
                    }
                    // Center the highlight around the current separator and use the spacing as height
                    highlightHeight = Math.max(2, spacing);
                    highlightY = current.lineY;
                }

                contentGroup.append('rect')
                    .attr('x', -margin.left)
                    .attr('y', highlightY)
                    .attr('width', width + margin.right + margin.left)
                    .attr('height', highlightHeight)
                    .attr('fill', getComputedStyle(root).getPropertyValue('--failure-color').trim())
                    .attr('opacity', 0.12)
                    .attr('pointer-events', 'none') // allow clicks to pass through the highlight
                    .lower();
                }
                    // Calculate and display utilization percentage.
                    const totalOpMinutes = opHours * 60;
                    const productiveMinutes = (wsInfo.cycleTime || 0) * (metrics.throughputUnitsPerDay || 0);
                    const actualUtilization = totalOpMinutes > 0 ? (productiveMinutes / totalOpMinutes) : 0;
                    contentGroup.append('text')
                        .attr('class', 'ws-efficiency-label')
                        .attr('x', 65).attr("y", lineY + 13)
                        .attr('text-anchor', 'start').style('font-size', '11px')
                        .style('font-weight', '600')
                        .style('fill', getComputedStyle(root).getPropertyValue('--accent').trim())
                        .text(`Util: ${(actualUtilization * 100).toFixed(1)}%`);

                    // Draw the utilization bar.
                    const barWidth = 50;
                    const barHeight = 4;
                    contentGroup.append('rect')
                        .attr('class', 'ws-utilization-bar-bg')
                        .attr('x', 8).attr("y", lineY + 7)
                        .attr('width', barWidth)
                        .attr('height', barHeight)
                        .attr('fill', getComputedStyle(root).getPropertyValue('--idle-color').trim())
                        .attr('stroke', getComputedStyle(root).getPropertyValue('--white').trim())
                        .attr('stroke-width', 0.5).attr('rx', 1); // Background.
                    contentGroup.append('rect')
                        .attr('class', 'ws-utilization-bar')
                        .attr('x', 8).attr("y", lineY + 7)
                        .attr('width', barWidth * actualUtilization)
                        .attr('height', barHeight)
                        .attr('fill', getComputedStyle(root).getPropertyValue('--primary').trim())
                        .attr('rx', 1); // Foreground.
                });
            }
        } catch (e) { console.warn('Could not render performance overlays:', e); }

        // --- TIME AXIS & MARKERS ---

        // Group for grid lines.
        const timeGridGroup = chart.append("g")
            .attr("class", "time-grid");
        
        // Group for the bottom time axis.
        const timeAxis = chart.append("g")
            .attr("class", "time-axis")
            .attr("transform", `translate(0, ${((height + margin.top + margin.bottom) * 0.93) - margin.top})`);

        // Add time axis label
        chart.append("text")
            .attr("class", "time-axis-label")
            .attr("x", width / 2)
            .attr("y", ((height + margin.top + margin.bottom) * 0.99) - margin.top)
            .attr("text-anchor", "middle")
            .style("font-size", "12px")
            .style("font-weight", "bold")
            .style("fill", getComputedStyle(root).getPropertyValue('--accent').trim())
            .text("Time (Hours : Minutes : Seconds)");

        // Vertical line for current time.
        const timeMarker = chart.append("line")
            .attr("x1", 0)
            .attr("x2", 0)
            .attr("y1", -margin.top)
            .attr("y2", height + margin.bottom)
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("stroke-width", 2);

        // Tooltip for the time marker
        timeMarker.append("title")
            .text("Current Simulation Time");

        // --- TOOLTIP & TASK BARS ---
        
        // Create a reusable tooltip
        const scheduleTooltip = createTooltip('schedule-tooltip');

        // Helper function to get product type name from model ID.
        const getProductTypeName = (modelId) => ({ 1: 'Super', 2: 'Ultra', 3: 'Mega' })[modelId] || 'Unknown';

        // Helper function to format time duration nicely.
        const formatDuration = (minutes) => (minutes < 1) ? `${(minutes * 60).toFixed(0)}s` : `${minutes.toFixed(2)}m`;

        // Bind task data and create the Gantt bars.
        contentGroup.append("g").attr("class", "task-bars")
            .selectAll(".bar").data(tasks).enter().append("rect")
            .attr("class", "bar")
            .attr("y", d => elementGeometry.get(d.taskId)?.y || -100) // Set Y position based on element geometry map.
            .attr("height", d => elementGeometry.get(d.taskId)?.height || 0) // Set height similarly.
            .attr("fill", d => defectiveProducts.get(d.uniqueId) ? getComputedStyle(root).getPropertyValue('--failure-color').trim() : modelColors(d.modelId)) // Set fill color based on defect status or product model.
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim()).attr("stroke-width", 1).attr("rx", 2).attr("ry", 2) // Styling.
            .style("opacity", d => (activeProductFilters[d.modelId] ? 0.9 : 0.0)) // Set initial opacity based on filters.
            .style("display", d => (activeProductFilters[d.modelId] ? "block" : "none")) // Set initial display based on filters.
            .style("transform", d => (activeProductFilters[d.modelId] ? "scale(1)" : "scale(0.95)"))
            .style("cursor", "pointer")
            .on("mouseenter", function (event, d) { // Tooltip mouseover behavior.
                d3.select(this).style("opacity", 1).style("stroke-width", 2); // Highlight bar.
                const productType = getProductTypeName(d.modelId);
                const duration = formatDuration(d.endTime - d.startTime);
                const startTime = `${Math.floor(d.startTime / 60).toString().padStart(2, '0')}:${Math.floor(d.startTime % 60).toString().padStart(2, '0')}:${Math.floor((d.startTime % 1) * 60).toString().padStart(2, '0')}`;
                const endTime = `${Math.floor(d.endTime / 60).toString().padStart(2, '0')}:${Math.floor(d.endTime % 60).toString().padStart(2, '0')}:${Math.floor((d.endTime % 1) * 60).toString().padStart(2, '0')}`;
                
                // Populate and show tooltip.
                scheduleTooltip.html(`
                <div class="tooltip-header" style="color: ${defectiveProducts.get(d.uniqueId) ? getComputedStyle(root).getPropertyValue('--failure-color').trim() : modelColors(d.modelId)};">${productType} Refrigerator</div>
                <div class="tooltip-row"><span>Element:</span> <strong>${d.taskId}</strong></div>
                <div class="tooltip-row"><span>Workstation:</span> <strong>${d.workstationId}</strong></div>
                <div class="tooltip-row"><span>Duration:</span> <strong>${duration}</strong></div>
                <div class="tooltip-row"><span>Start:</span> <strong>${startTime}</strong></div>
                <div class="tooltip-row"><span>End:</span> <strong>${endTime}</strong></div>
                <div class="tooltip-row"><span>Defective:</span> <strong>${defectiveProducts.get(d.uniqueId) ? 'Yes' : 'No'}</strong></div>
            `).style("opacity", 1);
            })
            .on("mousemove", function (event) { // Update tooltip position.
                scheduleTooltip
                    .style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 10) + "px");
            })
            .on("mouseleave", function () { // Hide tooltip and de-highlight bar.
                d3.select(this)
                    .style("opacity", 0.9)
                    .style("stroke-width", 1);
                scheduleTooltip.style("opacity", 0);
            });

        // --- ANIMATION LOOP ---
        const maxTime = tasks.length > 0 ? d3.max(tasks, d => d.endTime) : (opHours * 60);
        const totalSimDurationMinutes = maxTime;

        // Initialize the global animation state for this tab.
        animationState.schedule = {
            isRunning: true,
            lastFrameTime: performance.now(),
            totalSimTimeMins: 0,
            frameId: null,
            isPaused: false
        };

        /**
         * The main animation loop, called via requestAnimationFrame.
         * @param {number} currentTime - The current timestamp provided by the browser.
         */
        function animationLoop(currentTime) {
            if (!animationState.schedule.isRunning) return; // Exit if stopped.
            // Calculate time passed since last frame.
            const speedMultiplier = animationState.speedMultiplier;
            const realDeltaMs = currentTime - animationState.schedule.lastFrameTime;
            animationState.schedule.lastFrameTime = currentTime;
            // Advance simulation time if not paused.
            if (!isPaused && !animationState.schedule.isPaused) {
                const simDeltaMinutes = (realDeltaMs / 60000) * SIM_TIME_ACCELERATION * speedMultiplier;
                animationState.schedule.totalSimTimeMins += simDeltaMinutes;
            }
            const rawSimTimeMinutes = animationState.schedule.totalSimTimeMins;
            const displaySimTimeMinutes = Math.min(rawSimTimeMinutes, totalSimDurationMinutes);
            const completedThreshold = displaySimTimeMinutes + COMPLETION_EPSILON;

            // Update clock and counters.
            const h = String(Math.floor(displaySimTimeMinutes / 60)).padStart(2, '0');
            const m = String(Math.floor(displaySimTimeMinutes % 60)).padStart(2, '0');
            const s = String(Math.floor((displaySimTimeMinutes % 1) * 60)).padStart(2, '0');
            clockDisplay.text(`${h}:${m}:${s}`);
            const completedSuper = tasks.filter(t => t.endTime <= completedThreshold && t.modelId === 1 && t.taskId === 31).length;
            const completedUltra = tasks.filter(t => t.endTime <= completedThreshold && t.modelId === 2 && t.taskId === 31).length;
            const completedMega = tasks.filter(t => t.endTime <= completedThreshold && t.modelId === 3 && t.taskId === 31).length;
            superCounter.text(`Super: ${completedSuper}`);
            ultraCounter.text(`Ultra: ${completedUltra}`);
            megaCounter.text(`Mega: ${completedMega}`);

            // Update the time domain of the x-axis to create the scrolling effect.
            const viewStartTime = Math.min(rawSimTimeMinutes, totalSimDurationMinutes + END_PLAYOUT_BUFFER_MINUTES);
            xScale.domain([viewStartTime, viewStartTime + currentViewWindow]);

            // Update the position and width of all task bars based on the new xScale.
            contentGroup.selectAll(".bar")
                .attr("x", d => xScale(d.startTime))
                .attr("width", d => Math.max(0, xScale(d.endTime) - xScale(d.startTime)));

            // Update the time grid lines.
            const gridTicks = xScale.ticks(20);
            const gridLines = timeGridGroup.selectAll(".grid-line").data(gridTicks);
            gridLines.enter().append("line")
                .attr("class", "grid-line")
                .merge(gridLines)
                .attr("x1", d => xScale(d))
                .attr("x2", d => xScale(d))
                .attr("y1", -margin.top)
                .attr("y2", height + margin.bottom)
                .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
                .attr("stroke-width", 0.5)
                .attr("stroke-dasharray", "2,2")
                .style("opacity", 0.6);
            gridLines.exit().remove();

            // Redraw the bottom time axis.
            const timeTickFormat = (d) => {
                const h = Math.floor(d / 60);
                const m = Math.floor(d % 60);
                const s = Math.floor((d % 1) * 60);
                return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            };
            timeAxis.call(d3.axisBottom(xScale).ticks(10).tickFormat(timeTickFormat).tickSizeOuter(0))
                .selectAll("text")
                .style("font-size", "11px")
                .style("font-weight", "500");

            // Request the next frame.
            const finishedPlayback = rawSimTimeMinutes >= (totalSimDurationMinutes + END_PLAYOUT_BUFFER_MINUTES);
            if (finishedPlayback) {
                animationState.schedule.isRunning = false;
                animationState.schedule.totalSimTimeMins = totalSimDurationMinutes;
                const finalHours = String(Math.floor(totalSimDurationMinutes / 60)).padStart(2, '0');
                const finalMinutes = String(Math.floor(totalSimDurationMinutes % 60)).padStart(2, '0');
                const finalSeconds = String(Math.floor((totalSimDurationMinutes % 1) * 60)).padStart(2, '0');
                clockDisplay.text(`${finalHours}:${finalMinutes}:${finalSeconds}`);
                const finalThreshold = totalSimDurationMinutes + COMPLETION_EPSILON;
                superCounter.text(`Super: ${tasks.filter(t => t.endTime <= finalThreshold && t.modelId === 1 && t.taskId === 31).length}`);
                ultraCounter.text(`Ultra: ${tasks.filter(t => t.endTime <= finalThreshold && t.modelId === 2 && t.taskId === 31).length}`);
                megaCounter.text(`Mega: ${tasks.filter(t => t.endTime <= finalThreshold && t.modelId === 3 && t.taskId === 31).length}`);
                return;
            }
            animationState.schedule.frameId = requestAnimationFrame(animationLoop);
        }

        // --- FINALIZATION ---
        // Trigger a scroll event to correctly position the content group initially.
        workstationList.dispatchEvent(new Event('scroll'));

        // Start the animation loop.
        animationState.schedule.frameId = requestAnimationFrame(animationLoop);

        // --- LEGEND ---
        const legendX = containerWidth - 200;
        const legendY = boxY;
        const legend = infoGroup.append("g")
            .attr("transform", `translate(${legendX + 30}, ${legendY - 40})`);

        // Legend box
        legend.append("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", 150)
            .attr("height", 160)
            .attr("rx", 5)
            .classed("legend-box", true)
            .style("pointer-events", "auto");

        // Title
        legend.append("text")
            .text("Legend")
            .attr("x", 75)
            .attr("y", 20)
            .classed("legend-title", true);

        const legendItems = [
            { label: "Super Product", color: getComputedStyle(root).getPropertyValue('--super-color') },
            { label: "Ultra Product", color: getComputedStyle(root).getPropertyValue('--ultra-color') },
            { label: "Mega Product", color: getComputedStyle(root).getPropertyValue('--mega-color') },
            { label: "Defective Product", color: getComputedStyle(root).getPropertyValue('--failure-color') },
            { label: "Bottleneck WS", color: getComputedStyle(root).getPropertyValue('--failure-color'), type: "ws" },
            { label: "Utilization Bar", color: getComputedStyle(root).getPropertyValue('--primary'), type: "bar" }
        ];

        // Create an entry for each item in the legend.
        legendItems.forEach((item, i) => {
            const yPos = 45 + i * 20;
            if (item.type === "ws") {
                legend.append("rect")
                    .attr("x", 10)
                    .attr("y", yPos - 8)
                    .attr("width", 10)
                    .attr("height", 10)
                    .attr("fill", item.color)
                    .attr("opacity", 0.3);
            } else if (item.type === "bar") {
                legend.append("rect")
                    .attr("x", 10)
                    .attr("y", yPos - 4)
                    .attr("width", 10)
                    .attr("height", 4)
                    .attr("fill", item.color)
                    .attr("rx", 1);
            } else {
                legend.append("rect")
                    .attr("x", 10)
                    .attr("y", yPos - 8)
                    .attr("width", 10)
                    .attr("height", 10)
                    .attr("fill", item.color);
            }
            legend.append("text")
                .text(item.label)
                .attr("x", 25)
                .attr("y", yPos + 2)
                .classed("legend-item-text", true);
        });

        // Info button in bottom right
        const infoBtn = svg.append("g")
            .attr("transform", `translate(${containerWidth - 30}, ${containerHeight - 30})`)
            .style("cursor", "pointer");
        infoBtn.append("circle")
            .attr("r", 20)
            .attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim());
        infoBtn.append("text")
            .attr("x", 0)
            .attr("y", 6)
            .attr("text-anchor", "middle")
            .attr("fill", getComputedStyle(root).getPropertyValue('--white').trim())
            .style("font-size", "18px")
            .style("font-weight", "bold")
            .text("i");
        infoBtn.on("click", function () {
            infoPanelVisible = !infoPanelVisible;
            updateInfoPanelInteraction();
        });

        // Ensure initial interaction state reflects current visibility
        updateInfoPanelInteraction();

    }
    // Expose the public draw method to be called from the main script.
    return {
        draw: draw
    };
})();
