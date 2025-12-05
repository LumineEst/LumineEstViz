/**
* ====================================================================
* EfficiencyTab IIFE Module
*
* Encapsulates all logic for rendering the multi-chart efficiency
* analysis dashboard.
* ====================================================================
*/
const EfficiencyTab = (function () {

    // Module-level variables for one-time setup
    let tooltip = null;
    let defs = null;
    let effRoot = null;

    /**
     * Performs the full redraw and rescale of the efficiency dashboard.
     * @param {boolean} [isResize=false] - If true, animations will be instant (0 duration).
     */
    function internalDraw(isResize = false) {
        // --- DATA CALCULATION ---
        const opInputs = { dailyDemand: +dailyDemandInput.value, opHours: +opHoursInput.value, numEmployees: +numEmployeesInput.value };
        const finInputs = { laborCost: +laborCostInput.value };
        const results = calculateMetrics(opInputs, finInputs);

        // --- PRE-CALCULATIONS FOR BLINKING ---
        const bottleneckCycleTime = d3.max(results.workstations, d => d.cycleTime) || 0;
        const normalStroke = getComputedStyle(root).getPropertyValue('--accent').trim(); // Accent color (The "normal" stroke)
        const dangerStroke = getComputedStyle(root).getPropertyValue('--failure-color').trim(); // Failure color (Magenta)
        const defaultPieBgFill = getComputedStyle(root).getPropertyValue('--white').trim(); // Pie Text Background default fill is WHITE
        const normalStrokeWidth = 1.5;
        const blinkStrokeWidth = 3.5;
        // --- END PRE-CALCULATIONS ---

        // --- INITIAL SETUP ---
        const svg = d3.select("#efficiency-panel");
        const { clientWidth: panelWidth, clientHeight: panelHeight } = document.getElementById('svg-container');

        if (!results || !results.workstations || results.workstations.length === 0) {
            svg.selectAll("*").remove();
            svg.append("text").attr("x", panelWidth / 2).attr("y", panelHeight / 2).attr("text-anchor", "middle").text("No data available for efficiency analysis.");
            return;
        }

        if (animationState.efficiency && animationState.efficiency.frameId) {
            cancelAnimationFrame(animationState.efficiency.frameId);
            animationState.efficiency.frameId = null;
            animationState.efficiency.isRunning = false;
        }

        // --- ROOT GROUP & RESPONSIVE LAYOUT ---
        effRoot = svg.selectAll("g#eff-root").data([null]).join("g").attr("id", "eff-root");

        const padding = 20;
        const availableWidth = panelWidth - (2 * padding);
        const availableHeight = panelHeight - (2 * padding);
        const rows = 4;
        const rowHeight = availableHeight / rows;
        const maxPieRadius = Math.min(availableWidth / 15, (rowHeight * 0.75) / 2);
        const maxClockRadius = Math.min(availableWidth / 40, (rowHeight * 0.75) / 4);
        const pieRadius = maxPieRadius;
        const clockRadius = maxClockRadius;

        const layoutTransform = (i) => {
            let row, col, colsInRow;
            if (i < 4) { row = 1; col = i; colsInRow = 4; }
            else if (i < 9) { row = 2; col = i - 4; colsInRow = 5; }
            else { row = 3; col = i - 9; colsInRow = 4; }
            const itemWidth = availableWidth / colsInRow;
            const x = padding + col * itemWidth + itemWidth / 2;
            const y = padding + row * rowHeight + rowHeight / 2 + rowHeight * 0.05;
            return `translate(${x},${y})`;
        };

        // --- WORKSTATION GROUPS (Data Binding) ---
        const wsSel = effRoot.selectAll("g.ws").data(results.workstations, d => d.id);
        const wsEnter = wsSel.enter()
            .append("g")
            .attr("class", "ws")
            .attr("transform", (d, i) => layoutTransform(i));

        const centerDistance = (pieRadius + clockRadius) * 1.1;
        const chartsGroupOffset = rowHeight * 0.12;
        const pieOffsetX = chartsGroupOffset - centerDistance / 2;
        const clockOffsetX = chartsGroupOffset + centerDistance / 2;

        wsEnter.append("g").attr("class", "pie").attr("transform", `translate(${pieOffsetX}, 0)`);
        wsEnter.append("g").attr("class", "clock").attr("transform", `translate(${clockOffsetX}, 0)`);

        wsEnter.append("text")
            .attr("class", "ws-heading")
            .attr("x", 0)
            .attr("y", -Math.max(pieRadius + rowHeight * 0.05, rowHeight * 0.35));

        const wsMerge = wsEnter.merge(wsSel);

        wsMerge.transition().duration(isResize ? 0 : 750)
            .attr("transform", (d, i) => layoutTransform(i));

        wsMerge.select("g.pie").attr("transform", `translate(${pieOffsetX}, 0)`);
        wsMerge.select("g.clock").attr("transform", `translate(${clockOffsetX}, 0)`);
        wsMerge.select("text.ws-heading")
            .attr("y", -Math.max(pieRadius + rowHeight * 0.05, rowHeight * 0.35))
            .style("font-size", `${Math.max(Math.min(rowHeight * 0.08, availableWidth * 0.03), 12)}px`)
            .text(d => `Workstation ${d.id}`);

        wsSel.exit().remove();

        // --- PIE CHARTS (Productive vs. Idle Time) ---
        const arc = d3.arc().innerRadius(0).outerRadius(pieRadius);
        wsMerge.each(function (ws) {
            const pieGroup = d3.select(this).select("g.pie");
            const totalOpMinutes = opInputs.opHours * 60;
            const productiveMinutes = ws.cycleTime * results.throughputUnitsPerDay;
            const productiveRatio = totalOpMinutes > 0 ? Math.min(1, productiveMinutes / totalOpMinutes) : 0;
            const productivePercentage = productiveRatio * 100;

            const workAngle = productiveRatio * 2 * Math.PI;
            const shouldHideIdleSlice = productivePercentage >= 99.5;
            const data = [
                { label: "Productive", startAngle: 0, endAngle: workAngle, value: Math.min(productivePercentage, 99.99) },
                { label: "Idle", startAngle: workAngle, endAngle: 2 * Math.PI, value: Math.max(100 - productivePercentage, 0.01), hidden: shouldHideIdleSlice }
            ];
            const slices = pieGroup.selectAll("path.slice").data(data, d => d.label);
            const slicesEnter = slices.enter().append("path").attr("class", "slice")
                .attr("fill", d => d.label === "Productive" ? getComputedStyle(root).getPropertyValue('--primary') : getComputedStyle(document.documentElement).getPropertyValue('--secondary1'))
                .each(function (d) { this._current = { ...d, startAngle: 0, endAngle: 0 }; })
                .attr("d", function (d) { return arc(this._current); });
            const slicesMerged = slicesEnter.merge(slices);

            slicesMerged.transition("shape").duration(isResize ? 0 : 750).attrTween("d", function (d) {
                const i = d3.interpolate(this._current || d, d);
                this._current = i(1);
                return t => arc(i(t));
            });

            slicesMerged.each(function (d) {
                const element = d3.select(this);
                const targetOpacity = d.hidden ? 0 : 1;
                const duration = (targetOpacity === 0 && (element.style("opacity") || 1) > 0.5) ? 1600 : 200;
                element.transition("opacity").duration(isResize ? 0 : duration).style("opacity", targetOpacity);
            });
            slices.exit().remove();

            const pieTextBg = pieGroup.selectAll("circle.pie-text-bg").data([null]).join("circle")
                .attr("class", "pie-text-bg")
                .attr("r", pieRadius * 0.33)
                .attr("fill", defaultPieBgFill); // Set default fill here

            const pieText = pieGroup.selectAll("text.pie-text").data([productivePercentage]).join("text")
                .attr("class", "pie-text")
                .attr("dy", "0.35em")
                .style("font-size", `${Math.max(Math.min(pieRadius * 0.2, rowHeight * 0.06), 8)}px`);

            animateValue(pieText.node(), productivePercentage, isResize ? 0 : 800, val => `${val.toFixed(1)}%`);
            pieText.exit().remove();

            const sliceSelection = pieGroup.selectAll("path.slice");
            const pieTextBgSelection = pieGroup.selectAll("circle.pie-text-bg");

            const bottleneckCycleTime = d3.max(results.workstations, d => d.cycleTime) || 0;
            const isBottleneck = (ws.cycleTime || 0) === bottleneckCycleTime && bottleneckCycleTime > 0;

            // Use the CSS class for blinking
            sliceSelection.classed("bottleneck-pie-blink", isBottleneck);
            pieTextBgSelection.classed("bottleneck-pie-blink", isBottleneck);

            // Add hover/tooltips for pie slices
            slicesMerged
                .style("cursor", "pointer")
                .on("mouseover", function (event, d) {
                    // pop-out: translate slice outward along its centroid
                    try {
                        const centroid = arc.centroid(d);
                        const angle = Math.atan2(centroid[1], centroid[0]);
                        const offset = Math.max(pieRadius * 0.08, 6);
                        const tx = Math.cos(angle) * offset;
                        const ty = Math.sin(angle) * offset;
                        d3.select(this).transition().duration(200).attr("transform", `translate(${tx},${ty})`);
                    } catch (e) {
                        // fallback: small scale
                        d3.select(this).transition().duration(200).attr("transform", `scale(1.03)`);
                    }
                    tooltip.style("opacity", 1);
                    const idleMinutesLocal = Math.max(0, totalOpMinutes - productiveMinutes);
                    const content = `
                        <div style="font-weight:bold; margin-bottom:5px; text-align:center; border-bottom:1px solid ${getComputedStyle(root).getPropertyValue('--white')}; padding-bottom:4px;">Workstation ${ws.id}</div>
                        <strong>${d.label}:</strong> ${d.value.toFixed(1)}%<br>
                        <strong>Productive Minutes:</strong> ${productiveMinutes.toFixed(1)} min<br>
                        <strong>Idle Minutes:</strong> ${idleMinutesLocal.toFixed(1)} min
                    `;
                    tooltip.html(content)
                        .style("left", (event.pageX + 15) + "px")
                        .style("top", (event.pageY - 28) + "px");
                })
                .on("mousemove", (event) => {
                    tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px");
                })
                .on("mouseout", function (event, d) {
                    // revert transform
                    d3.select(this).transition().duration(200).attr("transform", null);
                    tooltip.style("opacity", 0);
                });

            // NO NEED FOR D3 TRANSITIONS HERE, CSS HANDLES IT
            // You can keep the normal transitions for resize/initial draw if they are used elsewhere:
            if (!isBottleneck) {
                sliceSelection.transition().duration(isResize ? 0 : 500)
                    .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
                    .attr("stroke-width", 1.5);
                pieTextBgSelection.transition().duration(isResize ? 0 : 500)
                    .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
                    .attr("stroke-width", 1.5);
            }
        });

        // --- IDLE TIME CLOCKS ---
        wsMerge.each(function (ws) {
            const totalOpMinutes = opInputs.opHours * 60;
            const productiveMinutes = ws.cycleTime * results.throughputUnitsPerDay;
            const idleMinutes = Math.max(0, totalOpMinutes - productiveMinutes);
            const idleHours = idleMinutes / 60;
            const clockGroup = d3.select(this).select("g.clock");

            clockGroup.selectAll("circle.clock-face").data([null]).join("circle")
                .attr("class", "clock-face")
                .attr("r", clockRadius)
                .attr("stroke-width", Math.max(clockRadius * 0.04, 1));

            const tickOuterRadius = clockRadius * 0.9,
                tickInnerRadius = clockRadius * 0.75,
                majorTickInnerRadius = clockRadius * 0.65;

            clockGroup.selectAll("line.clock-tick")
                .data(d3.range(0, 360, 30))
                .join("line")
                .attr("class", "clock-tick")
                .attr("x1", 0)
                .attr("y1", -tickOuterRadius)
                .attr("x2", 0)
                .attr("y2", (d, i) => i % 3 === 0 ? -majorTickInnerRadius : -tickInnerRadius)
                .attr("stroke-width", (d, i) => i % 3 === 0 ? Math.max(clockRadius * 0.06, 1.5) : Math.max(clockRadius * 0.04, 1))
                .attr("transform", d => `rotate(${d})`);

            clockGroup.selectAll("circle.clock-center-pin")
                .data([null])
                .join("circle")
                .attr("class", "clock-center-pin")
                .attr("r", Math.max(clockRadius * 0.06, 2));

            const angle = (idleHours / 12) * 2 * Math.PI;
            const handRadius = clockRadius * 0.8;
            const wsHand = clockGroup.selectAll("line.clock-hand")
                .data([angle]);

            wsHand.enter()
                .append("line")
                .attr("class", "clock-hand")
                .attr("x1", 0)
                .attr("y1", 0)
                .attr("x2", 0)
                .attr("y2", -handRadius)
                .attr("stroke-width", Math.max(clockRadius * 0.08, 2))
                .attr("transform", "rotate(0)")
                .merge(wsHand)
                .transition().duration(isResize ? 0 : 750)
                .attrTween("transform", function (a) {
                    const currentTransform = d3.select(this)
                        .attr('transform') || "rotate(0)";
                    const startAngleMatch = /rotate\(([-.\d]+)\)/.exec(currentTransform);
                    const startAngle = startAngleMatch ? parseFloat(startAngleMatch[1]) : 0;
                    const endAngle = (a * 180) / Math.PI;
                    const i = d3.interpolate(startAngle, endAngle);
                    return t => `rotate(${i(t)})`;
                });
            wsHand.exit().remove();

            const clockFace = clockGroup.select("circle.clock-face");
            const clockPin = clockGroup.select("circle.clock-center-pin");

            // Set clock face/pin initial colors (since CSS defaults are not using accent/danger)
            clockFace.attr("stroke", normalStroke);
            clockPin.attr("fill", normalStroke);

            // --- IDLE TIME BLINKING LOGIC (CLOCK) ---
            if (idleHours > 12) {
                clockFace.classed("over-idle-clock-blink", true);
            } else {
                clockFace.classed("over-idle-clock-blink", false);
            }

            const idleText = clockGroup.selectAll("text.clock-idle-text").data([idleHours]).join("text")
                .attr("class", "clock-idle-text")
                .attr("y", clockRadius + clockRadius * 0.5)
                .style("font-size", `${Math.max(Math.min(clockRadius * 0.4, rowHeight * 0.06), 10)}px`);

            // Numeric value tspan (animated)
            const idleValueTspan = idleText.selectAll("tspan.clock-idle-value").data([idleHours]).join("tspan")
                .attr("class", "clock-idle-value")
                .text(d => `${d.toFixed(1)}h`);

            // Label tspan (static)
            idleText.selectAll("tspan.clock-idle-label").data([null]).join("tspan")
                .attr("class", "clock-idle-label")
                .text(" Idle");

            animateValue(idleValueTspan.node(), idleHours, isResize ? 0 : 800, val => `${val.toFixed(1)}h`);

            // Make clock interactive: show exact idle minutes/hours on hover
            clockGroup.style("cursor", "default");
            clockGroup.selectAll(".clock-face, .clock-hand, .clock-center-pin, .clock-idle-text")
                .style("cursor", "pointer")
                .on("mouseover", function (event) {
                    tooltip.style("opacity", 1);
                    const content = `
                        <div style="font-weight:bold; margin-bottom:5px; text-align:center; border-bottom:1px solid ${getComputedStyle(root).getPropertyValue('--white')}; padding-bottom:4px;">Workstation ${ws.id} Idle Time</div>
                        <strong>Idle Hours:</strong> ${idleHours.toFixed(1)} h<br>
                        <strong>Idle Minutes:</strong> ${idleMinutes.toFixed(1)} min
                    `;
                    tooltip.html(content)
                        .style("left", (event.pageX + 15) + "px")
                        .style("top", (event.pageY - 28) + "px");
                })
                .on("mousemove", (event) => tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px"))
                .on("mouseout", function () { tooltip.style("opacity", 0); });
        });

        // --- TOP ROW SUMMARY PANEL ---
        const summaryPadding = panelWidth * 0.001;
        const summaryWidth = availableWidth - (2 * summaryPadding);
        const summaryHeight = rowHeight - (2 * summaryPadding);
        const summaryX = panelWidth / 2;
        const summaryY = padding + rowHeight / 2;

        const summary = effRoot.selectAll("g#eff-summary").data([null]).join(enter => {
            const summaryGroup = enter.append("g")
                .attr("id", "eff-summary");
            summaryGroup.append("rect")
                .attr("class", "summary-border");
            return summaryGroup;
        }).attr("transform", `translate(${summaryX}, ${summaryY})`);

        summary.select("rect.summary-border")
            .attr("x", -summaryWidth / 2)
            .attr("y", -summaryHeight / 2)
            .attr("width", summaryWidth)
            .attr("height", summaryHeight)
            .attr("rx", 10);

        // --- OVERALL EFFICIENCY PIE CHART (CENTER OF SUMMARY) ---
        const arcLine = d3.arc().innerRadius(0).outerRadius(pieRadius);
        const clampedEfficiency = Math.min(results.averageEfficiency, 99.99) / 100;
        const workAngle = clampedEfficiency * 2 * Math.PI;
        const shouldHideSummaryIdleSlice = results.averageEfficiency >= 99.5;
        const linePieData = [
            { label: "Work", startAngle: 0, endAngle: workAngle, value: Math.min(results.averageEfficiency, 99.99) },
            { label: "Idle", startAngle: workAngle, endAngle: 2 * Math.PI, value: Math.max(100 - results.averageEfficiency, 0.01), hidden: shouldHideSummaryIdleSlice }
        ];

        const pieGroup = summary.selectAll("g.pie-group").data([null]).join("g").attr("class", "pie-group").attr("transform", "translate(0, 15)");
        const sumSlices = pieGroup.selectAll("path.summary-pie-slice").data(linePieData, d => d.label);
        const sumSlicesEnter = sumSlices.enter().append("path").attr("class", "summary-pie-slice")
            .attr("fill", d => d.label === "Work" ? getComputedStyle(root).getPropertyValue('--primary') : getComputedStyle(root).getPropertyValue('--secondary1'))
            .each(function (d) { this._current = { ...d, startAngle: 0, endAngle: 0 }; })
            .attr("d", function (d) { return arcLine(this._current); });
        const sumSlicesMerged = sumSlicesEnter.merge(sumSlices);

        sumSlicesMerged.transition("shape").duration(isResize ? 0 : 750).attrTween("d", function (d) {
            const i = d3.interpolate(this._current || d, d);
            this._current = i(1);
            return t => arcLine(i(t));
        });
        sumSlicesMerged.each(function (d) {
            const element = d3.select(this);
            const targetOpacity = d.hidden ? 0 : 1;
            const duration = (targetOpacity === 0 && (element.style("opacity") || 1) > 0.5) ? 1500 : 200;
            element.transition("opacity").duration(isResize ? 0 : duration).style("opacity", targetOpacity);
        });
        sumSlices.exit().remove();

        summary.selectAll("circle.summary-pie-text-bg").data([null]).join("circle")
            .attr("class", "summary-pie-text-bg")
            .attr("transform", "translate(0, 15)")
            .attr("r", pieRadius * 0.33);

        const summaryPieText = summary.selectAll("text.summary-pie-text").data([results.averageEfficiency]).join("text")
            .attr("class", "summary-pie-text")
            .attr("transform", "translate(0, 15)")
            .attr("dy", "0.35em")
            .style("font-size", `${Math.max(Math.min(pieRadius * 0.2, rowHeight * 0.06), 10)}px`);

        animateValue(summaryPieText.node(), results.averageEfficiency, isResize ? 0 : 800, val => `${val.toFixed(1)}%`);

        // Hover tooltip for summary pie
        pieGroup.selectAll("path.summary-pie-slice")
            .style("cursor", "pointer")
            .on("mouseover", function (event, d) {
                // pop-out summary slice
                try {
                    const centroid = arcLine.centroid(d);
                    const angle = Math.atan2(centroid[1], centroid[0]);
                    const offset = Math.max(pieRadius * 0.08, 6);
                    const tx = Math.cos(angle) * offset;
                    const ty = Math.sin(angle) * offset;
                    d3.select(this).transition().duration(200).attr("transform", `translate(${tx},${ty})`);
                } catch (e) {
                    d3.select(this).transition().duration(200).attr("transform", `scale(1.03)`);
                }
                tooltip.style("opacity", 1);
                const content = `
                    <div style="font-weight:bold; margin-bottom:5px; text-align:center; border-bottom:1px solid ${getComputedStyle(root).getPropertyValue('--white')}; padding-bottom:4px;">Overall Efficiency</div>
                    <strong>Average Efficiency:</strong> ${results.averageEfficiency.toFixed(1)}%<br>
                    <strong>Total Idle Time:</strong> ${(results.totalIdleTime/60).toFixed(1)} h<br>
                    <strong>Bottleneck Cycle Time:</strong> ${bottleneckCycleTime.toFixed(1)} min
                `;
                tooltip.html(content)
                    .style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mousemove", (event) => tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px"))
            .on("mouseout", function () { d3.select(this).transition().duration(200).attr("transform", null); tooltip.style("opacity", 0); });

        // --- SUMMARY CHARTS (Box Plot & Bar Chart) ---
        const colWidth = summaryWidth / 3;
        const titleAreaHeight = 35;
        const chartAreaHeight = summaryHeight - titleAreaHeight;
        const chartAreaWidth = colWidth * 1.1;
        const labelFontSize = Math.min(summaryHeight * 0.06, 30);
        const labelSpacing = labelFontSize;
        const textSpacing = labelFontSize * 1.75; // Dynamic spacing based on font size
        const chartContainerY = -summaryHeight / 2 + titleAreaHeight + chartAreaHeight / 2;

        // --- BOX PLOT (Balance Loss per Cycle) ---
        const boxPlotGroup = summary.selectAll("g.box-plot-group")
            .data([null])
            .join("g")
            .attr("class", "box-plot-group")
            .attr("transform", `translate(${-colWidth * 0.8}, ${chartContainerY})`);

        const idleTimesPerCycle = results.workstations.map(ws => bottleneckCycleTime - ws.cycleTime);
        const q1 = d3.quantile(idleTimesPerCycle, 0.25) || 0,
            median = d3.quantile(idleTimesPerCycle, 0.5) || 0,
            q3 = d3.quantile(idleTimesPerCycle, 0.75) || 0;
        const min = d3.min(idleTimesPerCycle) || 0,
            max = d3.max(idleTimesPerCycle) || 0;
        const xBox = d3.scaleLinear().domain([0, max * 1.1 || 1]).range([-chartAreaWidth / 2, chartAreaWidth / 2]);
        const boxHeight = chartAreaHeight * 0.4;

        boxPlotGroup.selectAll("line.box-plot-center-line")
            .data([null])
            .join("line")
            .attr("class", "box-plot-center-line")
            .attr("y1", 0)
            .attr("y2", 0)
            .transition().duration(isResize ? 0 : 750)
            .attr("x1", xBox(min))
            .attr("x2", xBox(max));

        boxPlotGroup.selectAll("line.box-plot-whisker")
            .data([{ val: min, key: 'min' }, { val: max, key: 'max' }], d => d.key)
            .join("line")
            .attr("class", "box-plot-whisker")
            .attr("y1", -boxHeight / 2)
            .attr("y2", boxHeight / 2)
            .transition().duration(isResize ? 0 : 750)
            .attr("x1", d => xBox(d.val))
            .attr("x2", d => xBox(d.val));

        boxPlotGroup.selectAll("rect.box-plot-box")
            .data([null])
            .join("rect")
            .attr("class", "box-plot-box")
            .attr("y", -boxHeight / 2)
            .attr("height", boxHeight)
            .transition().duration(isResize ? 0 : 750)
            .attr("x", xBox(q1))
            .attr("width", xBox(q3) - xBox(q1));

        boxPlotGroup.selectAll("line.box-plot-median-line")
            .data([median])
            .join("line")
            .attr("class", "box-plot-median-line")
            .attr("y1", -boxHeight / 2)
            .attr("y2", boxHeight / 2)
            .transition().duration(isResize ? 0 : 750)
            .attr("x1", d => xBox(d))
            .attr("x2", d => xBox(d));

        const tooltipContent = `<div style="font-weight:bold; margin-bottom: 5px; text-align:center; border-bottom: 1px solid ${getComputedStyle(root).getPropertyValue('--white')}; padding-bottom: 4px;">Idle Time per Cycle</div><strong>Q1:</strong> ${q1.toFixed(2)} min<br><strong>Median:</strong> ${median.toFixed(2)} min<br><strong>Q3:</strong> ${q3.toFixed(2)} min<br><strong>Max:</strong> ${max.toFixed(2)} min`;

        boxPlotGroup.selectAll("rect.box-plot-tooltip-receiver").data([null]).join("rect")
            .attr("class", "box-plot-tooltip-receiver")
            .attr("x", -chartAreaWidth / 2)
            .attr("y", -chartAreaHeight / 2)
            .attr("width", chartAreaWidth)
            .attr("height", chartAreaHeight)
            .on("mouseover", () => tooltip.style("opacity", 1))
            .on("mousemove", (event) => tooltip.html(tooltipContent)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px"))
            .on("mouseout", () => tooltip.style("opacity", 0));

        // === BAR CHART (Workstation Idle Time) ===
        const barChartMargin = { top: 10, right: 5, bottom: 35, left: 40 };
        const barChartInnerWidth = chartAreaWidth - barChartMargin.left - barChartMargin.right;
        const barChartInnerHeight = chartAreaHeight - barChartMargin.top - barChartMargin.bottom;
        
        const barChartGroup = summary.selectAll("g.bar-chart-group").data([null]).join("g")
            .attr("class", "bar-chart-group")
            .attr("transform", `translate(${colWidth * 0.8 - chartAreaWidth / 2 + barChartMargin.left}, ${chartContainerY - chartAreaHeight / 2 + barChartMargin.top})`);

        const xBar = d3.scaleBand()
            .domain(results.workstations.map(d => d.id))
            .range([0, barChartInnerWidth])
            .padding(0.2);

        const yBar = d3.scaleLinear()
            .domain([0, d3.max(results.workstations, d => d.dailyIdleTime) * 1.1 || 1])
            .range([barChartInnerHeight, 0]);

        // X-axis for bar chart
        barChartGroup.selectAll(".x-axis").data([null]).join("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0, ${barChartInnerHeight})`)
            .call(d3.axisBottom(xBar).tickSizeOuter(0))
            .selectAll("text")
            .style("font-size", `${labelFontSize / 1.5}px`)
            .style("font-weight", "600")
            .attr("transform", "rotate(-45)")
            .attr("text-anchor", "end")
            .attr("dx", "-0.8em")
            .attr("dy", "0.15em");

        // Y-axis for bar chart
        barChartGroup.selectAll(".y-axis").data([null]).join("g")
            .attr("class", "y-axis")
            .call(d3.axisLeft(yBar).ticks(4).tickFormat(d => `${(d / 60).toFixed(1)}h`).tickSizeOuter(0))
            .selectAll("text")
            .style("font-size", `${labelFontSize / 1.5}px`)
            .style("font-weight", "600");

        // Bar chart bars with sequential animation
        const barSelection = barChartGroup.selectAll("rect.bar")
            .data(results.workstations, d => d.id);

        const enterSelection = barSelection.enter().append("rect")
            .attr("class", "bar")
            .attr("x", d => xBar(d.id))
            .attr("width", xBar.bandwidth())
            .attr("y", yBar(0))
            .attr("height", 0)
            .style("fill", "url(#box-gradient)")
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent'))
            .attr("stroke-width", 1.8)
            .on("mouseover", function (event, d) {
                tooltip.style("opacity", 1);
                d3.select(this).style("opacity", 0.8);
            })
            .on("mousemove", function (event, d) {
                const tooltipContent = `
                    <div style="font-weight:bold; margin-bottom: 5px; text-align:center; border-bottom: 1px solid ${getComputedStyle(root).getPropertyValue('--white')}; padding-bottom: 4px;">Workstation ${d.id}</div>
                    <strong>Daily Idle Time:</strong> ${(d.dailyIdleTime / 60).toFixed(1)} hours<br>
                    <strong>Idle Time:</strong> ${d.dailyIdleTime.toFixed(1)} minutes<br>
                    <strong>Efficiency:</strong> ${d.efficiency.toFixed(1)}%
                `;
                tooltip.html(tooltipContent)
                    .style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", function() {
                tooltip.style("opacity", 0);
                d3.select(this).style("opacity", 1);
            });

        const updateSelection = barSelection
            .on("mouseover", function(event, d) {
                tooltip.style("opacity", 1);
                d3.select(this).style("opacity", 0.8);
            })
            .on("mousemove", function(event, d) {
                const tooltipContent = `
                    <div style="font-weight:bold; margin-bottom: 5px; text-align:center; border-bottom: 1px solid ${getComputedStyle(root).getPropertyValue('--white')}; padding-bottom: 4px;">Workstation ${d.id}</div>
                    <strong>Daily Idle Time:</strong> ${(d.dailyIdleTime / 60).toFixed(2)} hours<br>
                    <strong>Idle Time:</strong> ${d.dailyIdleTime.toFixed(1)} minutes<br>
                    <strong>Efficiency:</strong> ${d.efficiency.toFixed(1)}%
                `;
                tooltip.html(tooltipContent)
                    .style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", function() {
                tooltip.style("opacity", 0);
                d3.select(this).style("opacity", 1);
            });

        const exitSelection = barSelection.exit();

        // Proper enter/update/exit flow for bars so they don't reset on layout changes
        // UPDATE existing bars (instant on resize)
        barSelection
            .attr("x", d => xBar(d.id))
            .attr("width", xBar.bandwidth())
            .transition().duration(isResize ? 0 : 500).ease(d3.easeQuadInOut)
            .attr("y", d => yBar(d.dailyIdleTime))
            .attr("height", d => barChartInnerHeight - yBar(d.dailyIdleTime));

        // ENTER new bars (instant on resize)
        const barsEnter = barSelection.enter().append("rect")
            .attr("class", "bar")
            .attr("x", d => xBar(d.id))
            .attr("width", xBar.bandwidth())
            // Start new bars at zero height so they animate from 0 on initial draw
            .attr("y", yBar(0))
            .attr("height", 0)
            .style("fill", "url(#box-gradient)")
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent'))
            .attr("stroke-width", 1.8)
            .on("mouseover", function(event, d) {
                tooltip.style("opacity", 1);
                d3.select(this).style("opacity", 0.8);
            })
            .on("mousemove", function(event, d) {
                const tooltipContent = `
                    <div style="font-weight:bold; margin-bottom: 5px; text-align:center; border-bottom: 1px solid ${getComputedStyle(root).getPropertyValue('--white')}; padding-bottom: 4px;">Workstation ${d.id}</div>
                    <strong>Daily Idle Time:</strong> ${(d.dailyIdleTime / 60).toFixed(1)} hours<br>
                    <strong>Idle Time:</strong> ${d.dailyIdleTime.toFixed(1)} minutes<br>
                    <strong>Efficiency:</strong> ${d.efficiency.toFixed(1)}%
                `;
                tooltip.html(tooltipContent)
                    .style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", function() {
                tooltip.style("opacity", 0);
                d3.select(this).style("opacity", 1);
            });

        // Animate entering bars up to their final height (instant on resize)
        barsEnter.transition().duration(isResize ? 0 : 500).ease(d3.easeQuadInOut)
            .attr("y", d => yBar(d.dailyIdleTime))
            .attr("height", d => barChartInnerHeight - yBar(d.dailyIdleTime));

        // EXIT removed bars: fade out then remove
        exitSelection.remove();

        // --- SUMMARY LABELS ---

        // Center Label Group
        const centerLabelGroup = summary.selectAll("g.center-label-group").data([results]).join("g")
            .attr("class", "center-label-group")
            .attr("transform", `translate(0, ${-summaryHeight / 2.35})`);

        centerLabelGroup.selectAll("text.summary-title").data(["Overall Efficiency"]).join("text")
            .attr("class", "summary-title")
            .style("font-size", `${labelFontSize}px`)
            .text(d => d);

        const totalIdleTextGroup = centerLabelGroup.selectAll("g.total-idle-text-group").data([null]).join("g")
            .attr("class", "total-idle-text-group")
            .attr("transform", `translate(0, ${labelSpacing})`);

        const totalIdleText = totalIdleTextGroup.selectAll("text.summary-text").data([results]).join("text")
            .attr("class", "summary-text")
            .attr("x", 0)
            .style("font-size", `${labelFontSize}px`);

        totalIdleText.selectAll("tspan.summary-label").data(["Total Idle Time: "]).join("tspan")
            .attr("class", "summary-label")
            .text(d => d);

        const totalIdleValueTspan = totalIdleText.selectAll("tspan.summary-value").data([results]).join("tspan")
            .attr("class", "summary-value");

        animateValue(totalIdleValueTspan.node(), results.totalIdleTime / 60, isResize ? 0 : 800, val => `${val.toFixed(1)}h`);

        // Left Box Plot Label Group
        const boxLabelGroup = summary.selectAll("g.box-label-group").data([results]).join("g")
            .attr("class", "box-label-group")
            .attr("transform", `translate(${-colWidth * 0.9}, ${-summaryHeight / 2.35})`);

        boxLabelGroup.selectAll("text.summary-title").data(["Balance Loss per Cycle"]).join("text")
            .attr("class", "summary-title")
            .style("font-size", `${labelFontSize}px`)
            .text(d => d);

        const idleTimeCVTextGroup = boxLabelGroup.selectAll("g.idle-time-cv-text-group").data([null]).join("g")
            .attr("class", "idle-time-cv-text-group")
            .attr("transform", `translate(0, ${labelSpacing})`);

        const cvText = idleTimeCVTextGroup.selectAll("text.summary-text").data([results]).join("text")
            .attr("class", "summary-text")
            .attr("x", 0)
            .style("font-size", `${labelFontSize}px`);

        cvText.selectAll("tspan.summary-label").data(["Idle Time CV: "]).join("tspan")
            .attr("class", "summary-label")
            .text(d => d);

        const cvValueTspan = cvText.selectAll("tspan.summary-value").data([results]).join("tspan")
            .attr("class", "summary-value");

        animateValue(cvValueTspan.node(), results.idleTimeCv, isResize ? 0 : 800, val => `${val.toFixed(1)}%`);

        // Right Bar Chart Label Group
        const barLabelGroup = summary.selectAll("g.bar-label-group").data([results]).join("g")
            .attr("class", "bar-label-group")
            .attr("transform", `translate(${colWidth * 0.9}, ${-summaryHeight / 2.35})`);

        barLabelGroup.selectAll("text.summary-title").data(["Total Balance Loss per Workstation"]).join("text")
            .attr("class", "summary-title")
            .style("font-size", `${labelFontSize}px`)
            .text(d => d);

        const balanceLossTextGroup = barLabelGroup.selectAll("g.balance-loss-text-group").data([null]).join("g")
            .attr("class", "balance-loss-text-group")
            .attr("transform", `translate(0, ${labelSpacing})`);

        const balanceText = balanceLossTextGroup.selectAll("text.summary-text").data([results]).join("text")
            .attr("class", "summary-text")
            .attr("x", 0)
            .style("font-size", `${labelFontSize}px`);

        balanceText.selectAll("tspan.summary-label").data(["Workstation Balance Loss: "]).join("tspan")
            .attr("class", "summary-label")
            .text(d => d);

        const balanceValueTspan = balanceText.selectAll("tspan.summary-value").data([results]).join("tspan")
            .attr("class", "summary-value");

        animateValue(balanceValueTspan.node(), results.balanceDelay, isResize ? 0 : 800, val => `${val.toFixed(1)}%`);
    }

    /**
     * @tab Efficiency
     * Public draw method. Sets up one-time elements (tooltip, defs)
     * and then calls internalDraw to render the dashboard.
     */
    function draw() {
        // One-time setup for the tooltip
        if (!tooltip) {
            tooltip = d3.select("body").append("div")
                .attr("class", "efficiency-tooltip"); // Use CSS class
        }

        const svg = d3.select("#efficiency-panel");

        // One-time setup for gradient definitions
        if (!defs) {
            defs = svg.append("defs");

            const boxGradient = defs.append("linearGradient")
                .attr("id", "box-gradient")
                .attr("x1", "0%")
                .attr("y1", "0%")
                .attr("x2", "0%")
                .attr("y2", "100%");

            boxGradient.selectAll("stop")
                .data([
                    { offset: "0%", color: getComputedStyle(root).getPropertyValue('--secondary2').trim() },
                    { offset: "100%", color: "#4d337aff" } // Darker shade of secondary2
                ])
                .join("stop")
                .attr("offset", d => d.offset)
                .attr("stop-color", d => d.color);
        }

        // Call the main rendering function
        internalDraw(false);
    }

    /**
     * @tab Efficiency
     * Public resize method. Calls internalDraw and flags it as a resize
     * to ensure animations are instant.
     */
    function resize() {
        internalDraw(true);
    }

    // Expose the public draw and resize methods.
    return {
        draw: draw,
        resize: resize
    };
})();