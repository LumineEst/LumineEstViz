const LayoutTab = (function () {

    // Define module-level variables if needed for state between draws/resizes
    // Example: let layoutTooltip = null; (Handled by createTooltip now)

    /**
     * @tab Layout
     * Draws the animated U-shaped factory layout visualization.
     * This is the main public method exposed by the IIFE.
     */
    function draw() {
        // --- Setup & Validation ---
        stopAllSimulations();
        const numEmployees = parseInt(numEmployeesInput.value, 10);
        const svg = d3.select("#layout-panel");
        svg.selectAll("*").remove(); // Clear previous drawing

        // Use the shared tooltip creation function
        const layoutTooltip = createTooltip('layout-element-tooltip');

        const config = state.configData[numEmployees];

        // Get container dimensions *inside* draw/resize
        const { clientWidth: containerWidth, clientHeight: containerHeight } = document.getElementById('svg-container');

        // Root element for CSS custom properties
        const root = document.documentElement;

        if (!config || Object.keys(config).length === 0) {
            svg.append("text")
                .attr("class", "layout-no-data-text") // Use CSS class
                .attr("x", containerWidth / 2) // Use current dimensions
                .attr("y", containerHeight / 2) // Use current dimensions
                .text("No configuration data for this number of workstations.");
            return;
        }

        let isLayoutValid = true;
        for (const stationId in config) {
            const elements = config[stationId];
            if (!elements || elements.length === 0) continue;
            const totalElementTime = elements.reduce(
                (sum, elId) => sum + (state.taskData.get(elId)?.elementTime || 0),
                0
            );
            const stationLengthFt = totalElementTime * 15;
            if (stationLengthFt > 0 && stationLengthFt < 13) {
                isLayoutValid = false;
                break;
            }
        }

        if (!isLayoutValid) {
            demandStatusEl.textContent = "Invalid Spacing";
            demandStatusEl.className = "status failure";
            svg.append("text")
                .attr("class", "layout-invalid-text") // Use CSS class
                .attr("x", containerWidth / 2) // Use current dimensions
                .attr("y", containerHeight / 2) // Use current dimensions
                .text("Error: A workstation's length is less than 13 feet.");
            return;
        }

        // --- Initial Calculations ---
        const opInputs = {
            dailyDemand: parseInt(dailyDemandInput.value, 10),
            opHours: parseFloat(opHoursInput.value),
            numEmployees: parseInt(numEmployeesInput.value, 10)
        };
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

        // --- LAYOUT CONFIGURATION ---
        const leftPanelWidth = containerWidth * 0.79;
        const rightPanelWidth = containerWidth * 0.2;
        const rightPanelX = leftPanelWidth;
        const uiPadding = containerWidth * 0.01;

        // --- Path and Point Generation ---
        const isEven = numEmployees % 2 === 0;
        const numLeft = isEven ? numEmployees / 2 : Math.floor(numEmployees / 2);
        const middleWsId = isEven ? null : numLeft + 1;
        let connectionPoint;
        const allPaths = [];
        const allPoints = [];
        const workstationBorders = [];

        for (let i = 1; i <= numEmployees; i++) {
            const wsId = i;
            const elements = config[wsId];
            if (!elements || elements.length === 0) continue;

            const totalElementTime = elements.reduce(
                (sum, elId) => sum + (state.taskData.get(elId)?.elementTime || 0),
                0
            );
            const totalLengthFt = totalElementTime * 15;
            let p;

            if (wsId === middleWsId) {
                const startPt = { x: 0, y: numLeft * 10 };
                const endPt = { x: 10, y: numLeft * 10 };
                const horizontal_segment_ft = 10;
                const vertical_leg_ft = Math.max(0, (totalLengthFt - horizontal_segment_ft) / 2);
                p = [
                    startPt,
                    { x: startPt.x, y: startPt.y + vertical_leg_ft },
                    { x: endPt.x, y: endPt.y + vertical_leg_ft },
                    endPt
                ];
            } else {
                let startPt;
                let endPt;
                let out_dx;
                let out_dy;

                if (wsId <= numLeft) {
                    startPt = { x: 0, y: (wsId - 1) * 10 };
                    endPt = { x: 0, y: wsId * 10 };
                    out_dx = -1;
                    out_dy = 0;
                } else {
                    const mirroredIndex = (isEven ? numLeft : numLeft + 1) - (wsId - numLeft - 1);
                    startPt = { x: 10, y: mirroredIndex * 10 };
                    endPt = { x: 10, y: (mirroredIndex - 1) * 10 };
                    out_dx = 1;
                    out_dy = 0;
                }

                if (isEven && (wsId === numLeft || wsId === numLeft + 1)) {
                    const leg_to_center = 5;
                    const leg_from_main = 2;
                    const mouth_ft = 6;
                    const extension_ft = Math.max(0, (totalLengthFt - leg_to_center - mouth_ft - leg_from_main) / 2);

                    if (wsId === numLeft) {
                        p = [
                            startPt,
                            { x: startPt.x, y: startPt.y + leg_from_main },
                            { x: startPt.x - extension_ft, y: startPt.y + leg_from_main },
                            { x: startPt.x - extension_ft, y: startPt.y + leg_from_main + mouth_ft },
                            { x: startPt.x, y: startPt.y + leg_from_main + mouth_ft },
                            { x: startPt.x + leg_to_center, y: startPt.y + leg_from_main + mouth_ft }
                        ];
                        connectionPoint = p[p.length - 1];
                    } else {
                        startPt = connectionPoint;
                        endPt = { x: 10, y: (numLeft - 1) * 10 };
                        p = [
                            startPt,
                            { x: startPt.x + leg_to_center, y: startPt.y },
                            { x: startPt.x + leg_to_center + extension_ft, y: startPt.y },
                            { x: startPt.x + leg_to_center + extension_ft, y: startPt.y - mouth_ft },
                            { x: startPt.x + leg_to_center, y: startPt.y - mouth_ft },
                            endPt
                        ];
                    }
                } else {
                    const leg1_ft = 2;
                    const leg2_ft = 2;
                    const mouth_ft = 6;
                    const extension_ft = Math.max(0, (totalLengthFt - leg1_ft - leg2_ft - mouth_ft) / 2);
                    const dx = Math.sign(endPt.x - startPt.x);
                    const dy = Math.sign(endPt.y - startPt.y);
                    p = [
                        startPt,
                        { x: startPt.x + dx * leg1_ft, y: startPt.y + dy * leg1_ft },
                        { x: startPt.x + dx * leg1_ft + out_dx * extension_ft, y: startPt.y + dy * leg1_ft + out_dy * extension_ft },
                        { x: startPt.x + dx * (leg1_ft + mouth_ft) + out_dx * extension_ft, y: startPt.y + dy * (leg1_ft + mouth_ft) + out_dy * extension_ft },
                        { x: endPt.x - dx * leg2_ft, y: endPt.y - dy * leg2_ft },
                        endPt
                    ];
                }
            }

            allPoints.push(...p);

            if (p && p.length > 1) {
                let borderPathString = "M " + p[0].x + " " + p[0].y;
                for (let j = 1; j < p.length; j++) {
                    borderPathString += " L " + p[j].x + " " + p[j].y;
                }
                workstationBorders.push({ wsID: i, path: borderPathString });
            }

            const elementColorScale = generateElementColorScale(i - 1, numEmployees, elements.length);
            let currentPathPosFt = 0;
            elements.forEach((elId, index) => {
                const task = state.taskData.get(elId);
                allPaths.push({
                    wsId: i,
                    elId: elId,
                    path: generateSubPath(p, currentPathPosFt, (task?.elementTime || 0) * 15),
                    color: elementColorScale(index), // Dynamic color
                    lineCap: 'round'
                });
                currentPathPosFt += (task?.elementTime || 0) * 15;
            });
        }


        if (allPoints.length === 0) return;

        // --- Scaling and Translation ---
        const minX_ft = d3.min(allPoints, d => d.x);
        const maxX_ft = d3.max(allPoints, d => d.x);
        const minY_ft = d3.min(allPoints, d => d.y);
        const maxY_ft = d3.max(allPoints, d => d.y);

        if ((maxX_ft - minX_ft) <= 0 || (maxY_ft - minY_ft) <= 0) return;

        const lineBBox = { width: maxX_ft - minX_ft, height: maxY_ft - minY_ft };
        const availableLineWidth = leftPanelWidth - (uiPadding * 2);
        const availableLineHeight = containerHeight - (uiPadding * 2.5);
        const scale = Math.min(availableLineWidth / lineBBox.width, availableLineHeight / lineBBox.height);

        const scaledLineWidth = lineBBox.width * scale;
        const leftPadding = (leftPanelWidth - scaledLineWidth) / 1.5;
        const translateX = (leftPadding - (minX_ft * scale));
        const translateY = uiPadding - (minY_ft * scale);

        // Create the main group with dynamic transform
        const g = svg.append("g")
            .attr("transform", `translate(${translateX}, ${translateY}) scale(${scale})`)
            .attr("fill", "none");

        // --- UI Element Positioning ---
        const clockY = containerHeight * 0.09;
        const clockBaseX = rightPanelX + (rightPanelWidth / 2) - (containerWidth * 0.02);
        const clockShiftX = containerWidth * 0.01;
        const clockX = clockBaseX + clockShiftX;
        const clockRadius = Math.min(rightPanelWidth * 0.5, containerHeight * 0.15 * 0.5);

        const speedoY = containerHeight * 0.35;
        const speedoX = clockX;
        const speedoRadius = Math.min(rightPanelWidth * 0.5, containerHeight * 0.15 * 0.5);

        // --- Clock ---
        const clockGroup = svg.append("g")
            .attr("transform", `translate(${clockX}, ${clockY})`);

        clockGroup.append("circle")
            .attr("class", "layout-clock-face")
            .attr("r", clockRadius);

        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * 2 * Math.PI;
            const tickLength = i % 3 === 0 ? 8 : 4;
            clockGroup.append("line")
                .attr("class", "layout-clock-tick")
                .attr("x1", Math.sin(angle) * (clockRadius - tickLength))
                .attr("y1", -Math.cos(angle) * (clockRadius - tickLength))
                .attr("x2", Math.sin(angle) * clockRadius)
                .attr("y2", -Math.cos(angle) * clockRadius)
                .attr("stroke-width", i % 3 === 0 ? 2 : 1);
        }

        clockGroup.append("line")
            .attr("id", "sim-clock-hour-hand")
            .attr("class", "layout-clock-hand layout-clock-hour-hand")
            .attr("y2", -clockRadius * 0.5);

        clockGroup.append("line")
            .attr("id", "sim-clock-minute-hand")
            .attr("class", "layout-clock-hand layout-clock-minute-hand")
            .attr("y2", -clockRadius * 0.8);

        clockGroup.append("circle")
            .attr("class", "layout-clock-center-pin")
            .attr("r", 4);

        // --- Speed Slider ---
        const sliderTopPadding = uiPadding * 1.1;
        const sliderHeight = (clockRadius * 2) - sliderTopPadding;
        const sliderGroup = svg.append("g")
            .attr("transform", `translate(${clockX + clockRadius + (containerWidth * 0.025)}, ${sliderTopPadding})`);

        const speedScale = d3.scaleLinear()
            .domain([0.1, 8.0])
            .range([sliderHeight, 0])
            .clamp(true);

        sliderGroup.append("line")
            .attr("class", "layout-speed-slider-track")
            .attr("y1", 0)
            .attr("y2", sliderHeight);

        sliderGroup.append("circle")
            .attr("id", "d3-layout-slider-handle")
            .attr("class", "layout-speed-slider-handle")
            .attr("r", 8)
            .attr("cy", speedScale(animationState.speedMultiplier));

        const interactionArea = sliderGroup.append("rect")
            .attr("class", "layout-speed-slider-interaction")
            .attr("y", 0)
            .attr("height", sliderHeight)
            .attr("x", -10)
            .attr("width", 20);

        const setFromPointer = (event) => {
            const getLocalY = (evt) => (evt && evt.sourceEvent && typeof evt.y === 'number')
                ? evt.y
                : d3.pointer(evt && evt.sourceEvent ? evt.sourceEvent : evt, sliderGroup.node())[1];
            const localY = Math.max(0, Math.min(sliderHeight, getLocalY(event)));
            const newValue = speedScale.invert(localY);
            animationState.speedMultiplier = newValue;
            sliderGroup.select(".layout-speed-slider-handle")
                .attr("cy", speedScale(newValue));
        };

        interactionArea
            .on("mousedown", function () { d3.select(this).style("cursor", "grabbing"); })
            .on("mouseup", function () { d3.select(this).style("cursor", "grab"); })
            .on("click", setFromPointer)
            .call(d3.drag().on("drag", setFromPointer));

        interactionArea.on("wheel", function (event) {
            event.preventDefault();
            const delta = event.deltaY > 0 ? -0.1 : 0.1;
            animationState.speedMultiplier = Math.max(0.1, Math.min(8.0, animationState.speedMultiplier + delta));
            d3.select("#d3-layout-slider-handle").attr("cy", speedScale(animationState.speedMultiplier));
        });

        sliderGroup.append("text")
            .attr("class", "layout-speed-slider-label")
            .attr("y", sliderHeight + 20)
            .text("Speed");

        // --- Animation Controls ---
        const controlsGroup = svg.append("g")
            .attr("transform", `translate(${clockBaseX}, ${clockY + clockRadius + 15})`);

        const playPauseBtn = controlsGroup.append("g")
            .attr("class", "layout-play-pause-btn sim-control-btn")
            .attr("transform", `translate(-32, 0)`);

        playPauseBtn.append("rect")
            .attr("width", 28).attr("height", 18).attr("rx", 3);

        const playPauseIcon = playPauseBtn.append("text")
            .attr("x", 14).attr("y", 13)
            .text(animationState.layout.isManuallyPaused ? "▶" : "⏸");

        const resetBtn = controlsGroup.append("g")
            .attr("class", "layout-reset-btn sim-control-btn")
            .attr("transform", "translate(0, 0)");

        resetBtn.append("rect")
            .attr("width", 28).attr("height", 18).attr("rx", 3);

        resetBtn.append("text")
            .attr("x", 14).attr("y", 13)
            .text("⟳");

        const skipBtn = controlsGroup.append("g")
            .attr("class", "layout-skip-btn sim-control-btn")
            .attr("transform", `translate(32, 0)`);

        skipBtn.append("rect")
            .attr("width", 28).attr("height", 18).attr("rx", 3);

        skipBtn.append("text")
            .attr("x", 14).attr("y", 13)
            .text("⏭");

        // --- Speedometer ---
        const speedoGroup = svg.append("g")
            .attr("transform", `translate(${speedoX}, ${speedoY})`);

        const speedoDomain = [0, 15];
        const colorThresholds = { slow: 4, medium: 10 };
        const radianScale = d3.scaleLinear().domain(speedoDomain).range([-Math.PI / 2, Math.PI / 2]);
        const arcGenerator = d3.arc()
            .innerRadius(speedoRadius * 0.7)
            .outerRadius(speedoRadius)
            .cornerRadius(3);
        const arcs = [
            { start: speedoDomain[0], end: colorThresholds.slow, color: getComputedStyle(root).getPropertyValue('--secondary2').trim() },
            { start: colorThresholds.slow, end: colorThresholds.medium, color: getComputedStyle(root).getPropertyValue('--primary').trim() },
            { start: colorThresholds.medium, end: speedoDomain[1], color: getComputedStyle(root).getPropertyValue('--secondary1').trim() }
        ];

        speedoGroup.selectAll("path.layout-speedo-arc")
            .data(arcs)
            .join("path")
            .attr("class", "layout-speedo-arc")
            .attr("fill", d => d.color)
            .attr("d", d => arcGenerator({ startAngle: radianScale(d.start), endAngle: radianScale(d.end) }));

        const ticks = radianScale.ticks(6);

        speedoGroup.selectAll("text.layout-speedo-tick-label")
            .data(ticks)
            .join("text")
            .attr("class", "layout-speedo-tick-label")
            .attr("x", d => Math.sin(radianScale(d)) * (speedoRadius + 15))
            .attr("y", d => -Math.cos(radianScale(d)) * (speedoRadius + 15))
            .attr("dominant-baseline", "central")
            .text(d => d3.format("d")(d));

        const targetAngleDeg = (radianScale(Math.min(speedoDomain[1], results.conveyorSpeed || 0)) * 180 / Math.PI);
        const needle = speedoGroup.selectAll("line.layout-speedo-needle")
            .data([targetAngleDeg]);

        needle.enter()
            .append("line")
            .attr("class", "layout-speedo-needle")
            .attr("id", "speedo-needle")
            .attr("y1", 10)
            .attr("y2", -speedoRadius * 0.9)
            .attr("transform", `rotate(${animationState.speedo.currentAngle})`)
            .merge(needle)
            .transition()
            .duration(750)
            .attrTween("transform", function (d) {
                const startAngle = animationState.speedo.currentAngle;
                const i = d3.interpolate(startAngle, d);
                return t => `rotate(${i(t)})`;
            })
            .on("end", () => { animationState.speedo.currentAngle = targetAngleDeg; });

        needle.exit().remove();

        speedoGroup.append("circle")
            .attr("class", "layout-speedo-center-pin")
            .attr("r", 8);

        speedoGroup.append("text")
            .attr("class", "layout-speedo-readout")
            .text(`${(results.conveyorSpeed || 0).toFixed(1)}`)
            .attr("y", speedoRadius * 0.5)
            .style("font-size", `${speedoRadius * 0.25}px`);

        speedoGroup.append("text")
            .attr("class", "layout-speedo-units")
            .text("ft/min")
            .attr("y", (speedoRadius * 0.75))
            .style("font-size", `${speedoRadius * 0.2}px`);

        // --- Finished Goods Bin ---
        const binAreaTopY = speedoY + speedoRadius + uiPadding;
        const binAreaBottomY = containerHeight - (uiPadding * 1.2);
        const binAreaHeight = binAreaBottomY - binAreaTopY;
        const binAreaCenterY = binAreaTopY + (binAreaHeight / 2);

        const maxContentWidth = rightPanelWidth - (uiPadding * 2);
        const maxContentHeight = binAreaHeight - (uiPadding * 2);

        const capacity = 552;
        let idealItemSize = 10;
        let numRows = 1;
        let numCols = 1;
        let idealFinalContentWidth = idealItemSize;
        let idealFinalContentHeight = idealItemSize;
        let itemPadding = idealItemSize * 0.1;

        if (maxContentWidth > 0 && maxContentHeight > 0 && capacity > 0) {
            const aspectRatio = maxContentWidth / maxContentHeight;
            numRows = Math.max(1, Math.round(Math.sqrt(capacity / aspectRatio)));
            numCols = Math.max(1, Math.ceil(capacity / numRows));

            const itemSizeWithPaddingWidth = maxContentWidth / numCols;
            const itemSizeWithPaddingHeight = maxContentHeight / numRows;
            const itemSizeWithPadding = Math.min(itemSizeWithPaddingWidth, itemSizeWithPaddingHeight);

            itemPadding = itemSizeWithPadding * 0.1;
            idealItemSize = itemSizeWithPadding - itemPadding;

            if (idealItemSize < 1) {
                idealItemSize = 1;
                itemPadding = 0;
            }

            idealFinalContentWidth = numCols * (idealItemSize + (itemPadding * 1.1));
            idealFinalContentHeight = numRows * (idealItemSize + itemPadding) - itemPadding;
            if (idealFinalContentHeight < 0) idealFinalContentHeight = idealItemSize;
        }

        const actualBinRectHeight = Math.min(idealFinalContentHeight, maxContentHeight);
        const binContentStartY = binAreaCenterY - (actualBinRectHeight / 2);
        const actualBinRectWidth = idealFinalContentWidth - itemPadding;
        const rightPanelCenterX = rightPanelX + (rightPanelWidth / 2);
        const binContentStartX = rightPanelCenterX - (idealFinalContentWidth / 2);

        const binConfig = {
            productPixelSize: idealItemSize,
            itemsPerRow: numCols,
            padding: itemPadding,
            binPixelX_Start: binContentStartX,
            binPixelY_Bottom: binContentStartY + idealFinalContentHeight,
        };

        svg.append("rect")
            .attr("class", "layout-bin-rect")
            .attr("x", binContentStartX)
            .attr("y", binContentStartY)
            .attr("width", actualBinRectWidth)
            .attr("height", actualBinRectHeight);

        svg.append("text")
            .attr("class", "layout-bin-title")
            .text("Finished Goods")
            .attr("x", rightPanelCenterX)
            .attr("y", binContentStartY - 10);

        // --- Legend and Grid ---
        const legendWidth = 170;
        const legendHeight = 110;
        const legendX = containerWidth * 0.01;
        const legendY = binContentStartY + actualBinRectHeight - legendHeight;
        const legendGroup = svg.append("g")
            .attr("transform", `translate(${legendX}, ${legendY})`);

        legendGroup.append("rect")
            .attr("width", legendWidth)
            .attr("height", legendHeight)
            .attr("rx", 5)
            .classed("legend-box", true);

        legendGroup.append("text")
            .text("Legend")
            .attr("x", legendWidth / 2)
            .attr("y", 20)
            .classed("legend-title", true);

        const itemsGrid = [
            [
                { label: "Super", color: getComputedStyle(root).getPropertyValue('--super-color').trim() },
                { label: "Ultra", color: getComputedStyle(root).getPropertyValue('--ultra-color').trim() },
                { label: "Mega", color: getComputedStyle(root).getPropertyValue('--mega-color').trim() }
            ],
            [

                { label: "Idle", color: getComputedStyle(root).getPropertyValue('--idle-color').trim() },
                { label: "Defective Unit", color: getComputedStyle(root).getPropertyValue('--failure-color').trim() }
            ]
        ];

        const gridStartX = 15;
        const gridStartY = 45;
        const rowGap = 25;
        const colGap = 50;

        itemsGrid.forEach((rowItems, rowIndex) => {
            rowItems.forEach((item, colIndex) => {
                const xPos = gridStartX + colIndex * colGap;
                const yPos = gridStartY + rowIndex * rowGap;

                legendGroup.append("rect")
                    .attr("x", xPos)
                    .attr("y", yPos - 8)
                    .attr("width", 10)
                    .attr("height", 10)
                    .attr("fill", item.color)
                    .attr("rx", 2);

                legendGroup.append("text")
                    .text(item.label)
                    .attr("x", xPos + 15)
                    .attr("y", yPos)
                    .attr("dominant-baseline", "middle")
                    .classed("legend-item-text", true)
                    .style("font-size", "12px")
                    .style("fill", getComputedStyle(root).getPropertyValue('--accent').trim());
            });
        });

        const squareGroup = legendGroup.append("g")
            .attr("transform", `translate(0, ${legendHeight - 15})`);

        squareGroup.append("rect")
            .attr("class", "layout-legend-grid-square")
            .attr("x", gridStartX)
            .attr("y", -8)
            .attr("width", 10)
            .attr("height", 10)
            .attr("rx", 2);

        squareGroup.append("text")
            .attr("x", gridStartX + 15)
            .attr("y", 0)
            .attr("dominant-baseline", "middle")
            .classed("legend-item-text", true)
            .text("Grid Size: 10 ft x 10 ft")
            .style("font-size", "12px")
            .style("fill", getComputedStyle(root).getPropertyValue('--accent').trim());

        // Grid Group
        const gridGroup = g.append("g");
        const gridBounds = {
            x1: (0 - translateX) / scale,
            y1: (0 - translateY) / scale,
            x2: (containerWidth - translateX) / scale,
            y2: (containerHeight - translateY) / scale
        };
        for (let x = Math.floor(gridBounds.x1 / 10) * 10; x <= gridBounds.x2; x += 10) {
            gridGroup.append("line")
                .attr("x1", x).attr("y1", gridBounds.y1)
                .attr("x2", x).attr("y2", gridBounds.y2);
        }
        for (let y = Math.floor(gridBounds.y1 / 10) * 10; y <= gridBounds.y2; y += 10) {
            gridGroup.append("line")
                .attr("x1", gridBounds.x1).attr("y1", y)
                .attr("x2", gridBounds.x2).attr("y2", y);
        }
        gridGroup.selectAll("line").attr("class", "layout-grid-line");

        // --- Draw Layout Paths ---
        const reversedPaths = [...allPaths].reverse();
        g.selectAll("g.layout-element-group")
            .data(reversedPaths, d => `${d.wsId}-${d.elId}`)
            .join("g")
            .attr("class", "layout-element-group")
            .each(function (d) {
                const group = d3.select(this);

                group.append("path")
                    .attr("class", "layout-element-hover-path")
                    .attr("d", d.path)
                    .attr("stroke-linecap", d.lineCap);

                group.append("path")
                    .attr("class", "layout-element-accent-border")
                    .attr("d", d.path)
                    .attr("stroke-linecap", d.lineCap);

                group.append("path")
                    .attr("class", "layout-element-color-path")
                    .attr("d", d.path)
                    .attr("stroke", d.color)
                    .attr("stroke-linecap", d.lineCap);
            })
            .on("mouseover", (event, d) => {
                const task = state.taskData.get(d.elId);
                // Fallback for legacy static data if task not found
                const laborTime = (task?.laborTime || 0).toFixed(2);
                const description = task?.description || "No description available";

                layoutTooltip.style("opacity", 1)
                    .html(
                        `<div class="tooltip-header">Element ${d.elId} (WorkStation ${d.wsId})</div>
                         <div class="tooltip-row"><span>Description:</span> <span>${description}</span></div>`
                    );
            })
            .on("mousemove", (event) => {
                const tooltipNode = layoutTooltip.node();
                if (!tooltipNode) return;
                const { width, height } = tooltipNode.getBoundingClientRect();
                const padding = 15;
                let left = event.pageX + padding;
                let top = event.pageY + padding;
                if (left + width > window.innerWidth) { left = event.pageX - width - padding; }
                if (top + height > window.innerHeight) { top = event.pageY - height - padding; }
                layoutTooltip.style("left", `${left}px`).style("top", `${top}px`);
            })
            .on("mouseout", () => {
                layoutTooltip.style("opacity", 0);
            });

        g.selectAll("path.layout-workstation-border")
            .data(workstationBorders, d => d.wsId)
            .join("path")
            .attr("class", "layout-workstation-border")
            .attr("d", d => d.path);

        // --- Simulation Setup and Initialization ---
        // CORRECTED: Use dynamic systemState.assemblyLineLength
        const totalDurationMin = (systemState.assemblyLineLength / results.conveyorSpeed);
        const launchDelayMin = (results.productSpacing / results.conveyorSpeed);

        if (isFinite(totalDurationMin) && totalDurationMin > 0 && isFinite(launchDelayMin) && launchDelayMin > 0) {
            let masterPathString = "";
            allPaths.forEach((pathData, i) => {
                masterPathString += i === 0 ? pathData.path : pathData.path.replace('M', ' ');
            });
            const masterPathNode = g.append("path").attr("d", masterPathString).node();

            let cumulativeDist = 0;
            const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
            const elementMap = allPaths.map(p => {
                tempPath.setAttribute('d', p.path);
                const len = tempPath.getTotalLength();
                const segment = { elementId: p.elId, startDist: cumulativeDist, endDist: cumulativeDist + len };
                cumulativeDist += len;
                return segment;
            });

            // CORRECTED: Use dynamic systemState.assemblyLineLength
            const simulationConfig = {
                svg,
                g,
                masterPathNode,
                elementMap,
                opHours: opInputs.opHours,
                productionQueue: generateProductionQueue(opInputs.dailyDemand),
                totalDurationMs: (systemState.assemblyLineLength / results.conveyorSpeed) * 1000 * 60,
                launchDelayMs: (results.productSpacing / results.conveyorSpeed) * 1000 * 60,
                binConfig,
                scale,
                qualityYield: qualityYield,
                defectStatus: defectStatus
            };

            // --- Event Listeners ---
            playPauseBtn.on("click", () => {
                animationState.layout.isPaused = !animationState.layout.isPaused;
                animationState.layout.isManuallyPaused = animationState.layout.isPaused;
                playPauseBtn.select('text').text(animationState.layout.isPaused ? "▶" : "⏸");
                if (!animationState.layout.isPaused && !animationState.layout.isRunning) {
                    svg.selectAll(".layout-product-shape").remove();
                    startSimulation(simulationConfig);
                }
            });
            resetBtn.on("click", () => {
                stopAllSimulations();
                animationState.layout.isPaused = false;
                animationState.layout.isManuallyPaused = false;
                playPauseBtn.select('text').text("⏸");
                svg.selectAll(".layout-product-shape").remove();
                startSimulation(simulationConfig);
            });
            skipBtn.on("click", () => {
                const layout = animationState.layout || {};
                if (layout.frameId) { cancelAnimationFrame(layout.frameId); layout.frameId = null; }
                layout.isRunning = false;
                if (Array.isArray(layout.productsOnLine)) { layout.productsOnLine.forEach(p => p.element && p.element.remove()); layout.productsOnLine = []; }
                svg.selectAll(".layout-product-shape").remove();
                const queue = Array.isArray(layout.productionQueue) ? layout.productionQueue : [];
                const binCfg = layout.binConfig || (typeof binConfig !== 'undefined' ? binConfig : null);
                for (let i = 0; i < queue.length; i++) {
                    const modelId = queue[i];
                    const isDefective = defectStatus[i];
                    const element = createProductShape(g, modelId);
                    if (isDefective) {
                        element.attr('fill', getComputedStyle(root).getPropertyValue('--failure-color').trim());
                    }
                    if (binCfg) { placeInBin(element, i, binCfg, svg); }
                    else { element && element.remove(); }
                }
                layout.finishedGoodsCount = queue.length; layout.queueIndex = queue.length;
                const launchMs = layout.launchDelayMs || 0; const totalDurMs = layout.totalDurationMs || 0;
                const totalSimTimeMs = (launchMs * Math.max(0, queue.length - 1)) + totalDurMs;
                layout.totalSimTimeMs = totalSimTimeMs;
                const simMinutes = (totalSimTimeMs / 1000) / 60; const simHours = simMinutes / 60;
                d3.select("#sim-clock-minute-hand").attr("transform", `rotate(${(simMinutes % 60) / 60 * 360})`);
                d3.select("#sim-clock-hour-hand").attr("transform", `rotate(${(simHours % 12) / 12 * 360})`);
                layout.isPaused = true; layout.isManuallyPaused = true;
                animationState.layout = layout; playPauseBtn.select('text').text("▶");
            });

            startSimulation(simulationConfig);
        }
    }

    // --- INNER HELPER FUNCTIONS ---

    /**
     * Creates an SVG shape (circle, square, or triangle) for a product model.
     * Uses CSS classes for styling.
     */
    function createProductShape(container, modelId) {
        const modelColors = {
            1: getComputedStyle(document.documentElement).getPropertyValue('--super-color').trim(),
            2: getComputedStyle(document.documentElement).getPropertyValue('--ultra-color').trim(),
            3: getComputedStyle(document.documentElement).getPropertyValue('--mega-color').trim()
        };
        const modelBorders = {
            1: getComputedStyle(document.documentElement).getPropertyValue('--secondary1').trim(),
            2: getComputedStyle(document.documentElement).getPropertyValue('--secondary2').trim(),
            3: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
        };
        const modelShapes = { 1: 'square', 2: 'triangle', 3: 'circle' };
        const shapeType = modelShapes[modelId];

        let shapeSize = 1.5;
        let shape;
        const className = `layout-product-shape ${shapeType}`;

        if (shapeType === 'circle') {
            shapeSize = 1.55;
            shape = container.append("circle")
                .attr("class", className)
                .attr("r", shapeSize / 2);
        } else if (shapeType === 'square') {
            shapeSize = 1.55;
            shape = container.append("rect")
                .attr("class", className)
                .attr("x", -shapeSize / 2)
                .attr("y", -shapeSize / 2)
                .attr("width", shapeSize)
                .attr("height", shapeSize);
        } else if (shapeType === 'triangle') {
            shapeSize = 1.47;
            const h = shapeSize * (Math.sqrt(3) / 2);
            shape = container.append("polygon")
                .attr("class", className)
                .attr("points", `0,${-h / 1.5} ${shapeSize / 1.5},${h / 2} ${-shapeSize / 1.5},${h / 2}`);
        }

        if (shape) {
            shape.attr("fill", modelColors[modelId])
                .attr("stroke", modelBorders[modelId]);
        }
        return shape;
    }

    /**
     * Moves a product shape to its final position in the finished goods bin.
     */
    function placeInBin(element, count, binConfig, svg) {
        const { binPixelX_Start, binPixelY_Bottom, itemsPerRow, productPixelSize, padding } = binConfig;
        const row = Math.floor(count / itemsPerRow);
        const col = count % itemsPerRow;
        const slotSize = productPixelSize + padding;

        if (element && element.node() && element.node().parentNode !== svg.node()) {
            svg.node().appendChild(element.node());
        }

        const newX = binPixelX_Start + (col * slotSize) + (slotSize / 2);
        const newY = binPixelY_Bottom - (row * slotSize) - (slotSize / 2);

        const newScale = productPixelSize / 1.8;

        element.transition().duration(300).attr('transform', `translate(${newX}, ${newY}) rotate(0) scale(${newScale})`);
    }


    /**
     * Generates an SVG path string for a portion of a larger path.
     */
    function generateSubPath(points, startFt, lengthFt) {
        let pathString = "M ";
        let traveledFt = 0;
        let started = false;
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const segLenFt = Math.sqrt(Math.pow(curr.x - prev.x, 2) + Math.pow(curr.y - prev.y, 2));

            if (!started && traveledFt + segLenFt >= startFt) {
                const ratio = segLenFt > 0 ? (startFt - traveledFt) / segLenFt : 0;
                pathString += `${prev.x + ratio * (curr.x - prev.x)} ${prev.y + ratio * (curr.y - prev.y)}`;
                started = true;
            }

            if (started) {
                if (traveledFt + segLenFt <= startFt + lengthFt) {
                    pathString += ` L ${curr.x} ${curr.y}`;
                } else {
                    const ratio = segLenFt > 0 ? (startFt + lengthFt - traveledFt) / segLenFt : 0;
                    pathString += ` L ${prev.x + ratio * (curr.x - prev.x)} ${prev.y + ratio * (curr.y - prev.y)}`;
                    return pathString;
                }
            }
            traveledFt += segLenFt;
        }
        if (pathString === "M ") {
            if (points.length > 0 && startFt === 0) {
                return `M ${points[0].x} ${points[0].y}`;
            } else if (points.length > 0) {
                const lastPt = points[points.length - 1];
                return `M ${lastPt.x} ${lastPt.y}`;
            } else {
                return "M 0 0";
            }
        }
        return pathString;
    }

    /**
     * Initializes and runs the main animation loop for the layout simulation.
     */
    function startSimulation(config) {
        stopAllSimulations();
        let { svg, g, masterPathNode, productionQueue, totalDurationMs, launchDelayMs, binConfig, elementMap, scale, qualityYield, defectStatus } = config;
        if (!masterPathNode || totalDurationMs <= 0 || launchDelayMs <= 0) return;

        const now = performance.now();
        animationState.layout = {
            ...config,
            isRunning: true,
            isPaused: false,
            lastFrameTime: now,
            totalSimTimeMs: 0,
            nextLaunchTime: 0,
            productsOnLine: [],
            queueIndex: 0,
            finishedGoodsCount: 0,
            pathLength: masterPathNode.getTotalLength()
        };
        function animationLoop(currentTime) {
            if (!animationState.layout.isRunning) return;

            const speedMultiplier = animationState.speedMultiplier;
            const realDeltaMs = currentTime - animationState.layout.lastFrameTime;
            animationState.layout.lastFrameTime = currentTime;

            if (!animationState.layout.isPaused) {
                const simDeltaMs = realDeltaMs * speedMultiplier * 60;
                animationState.layout.totalSimTimeMs += simDeltaMs;
            }

            const elapsedSimTimeMs = animationState.layout.totalSimTimeMs;
            const simMinutes = (elapsedSimTimeMs / 1000) / 60;
            const simHours = simMinutes / 60;
            d3.select("#sim-clock-minute-hand").attr("transform", `rotate(${(simMinutes % 60) / 60 * 360})`);
            d3.select("#sim-clock-hour-hand").attr("transform", `rotate(${(simHours % 12) / 12 * 360})`);

            if (
                animationState.layout.totalSimTimeMs >= animationState.layout.nextLaunchTime &&
                animationState.layout.queueIndex < animationState.layout.productionQueue.length
            ) {
                const modelId = animationState.layout.productionQueue[animationState.layout.queueIndex];
                animationState.layout.productsOnLine.push({
                    modelId: modelId,
                    launchTime: animationState.layout.totalSimTimeMs,
                    element: createProductShape(g, modelId),
                    isDefective: defectStatus[animationState.layout.queueIndex]
                });
                animationState.layout.queueIndex++;
                animationState.layout.nextLaunchTime += animationState.layout.launchDelayMs;
            }

            for (let i = animationState.layout.productsOnLine.length - 1; i >= 0; i--) {
                const product = animationState.layout.productsOnLine[i];
                const progress = (animationState.layout.totalSimTimeMs - product.launchTime) / animationState.layout.totalDurationMs;

                if (progress >= 1) {
                    placeInBin(product.element, animationState.layout.finishedGoodsCount, animationState.layout.binConfig, svg);
                    animationState.layout.finishedGoodsCount++;
                    animationState.layout.productsOnLine.splice(i, 1);
                } else {
                    const distance = animationState.layout.pathLength * progress;
                    const pos = animationState.layout.masterPathNode.getPointAtLength(distance);
                    const nextPos = animationState.layout.masterPathNode.getPointAtLength(distance + 1);
                    const angle = Math.atan2(nextPos.y - pos.y, nextPos.x - pos.x) * 180 / Math.PI;

                    const modelShapes = { 1: 'square', 2: 'triangle', 3: 'circle' };
                    const shapeType = modelShapes[product.modelId];
                    let offset = 0.1;
                    if (shapeType === 'circle') offset = 0;
                    if (shapeType === 'square') offset = 0.01;
                    if (shapeType === 'triangle') offset = 0.14;

                    const perpAngle = angle + 90;
                    const offsetX = Math.cos(perpAngle * Math.PI / 180) * offset;
                    const offsetY = Math.sin(perpAngle * Math.PI / 180) * offset;

                    product.element.attr('transform', `translate(${pos.x + offsetX},${pos.y + offsetY}) rotate(${angle})`);

                    const currentSegment = elementMap.find(e => distance >= e.startDist && distance < e.endDist);
                    const modelColors = { 1: '--super-color', 2: '--ultra-color', 3: '--mega-color' };
                    const shapeModelColorVar = modelColors[product.modelId];

                    product.element.attr(
                        'fill',
                        product.isDefective ? getComputedStyle(document.documentElement).getPropertyValue('--failure-color').trim() :
                            (currentSegment && doesElementBuildModel(currentSegment.elementId, product.modelId))
                                ? getComputedStyle(document.documentElement).getPropertyValue(shapeModelColorVar).trim()
                                : getComputedStyle(document.documentElement).getPropertyValue('--idle-color').trim()
                    );
                }
            }

            if (animationState.layout.productsOnLine.length > 0 || animationState.layout.queueIndex < animationState.layout.productionQueue.length) {
                animationState.layout.frameId = requestAnimationFrame(animationLoop);
            } else {
                animationState.layout.isRunning = false;
            }
        }
        animationState.layout.frameId = requestAnimationFrame(animationLoop);
    }

    /**
     * Public resize function. Simply calls draw() as draw handles resizing internally.
     */
    function resize() {
        draw();
    }

    // Expose the public draw and resize methods.
    return {
        draw: draw,
        resize: resize // Add the resize method
    };
})();