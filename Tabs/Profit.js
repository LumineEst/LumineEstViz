const ProfitTab = (function () {
    // Helper function to create the custom tooltip (assuming it's available globally or defined elsewhere)
    function createTooltip(id) {
        let tooltip = d3.select("body").select(`#${id}`);
        if (tooltip.empty()) {
            tooltip = d3.select("body").append("div")
                .attr("class", `d3-tooltip ${id}`)
                .attr("id", id)
                .style("opacity", 0);
        }
        return tooltip;
    }

    const root = document.documentElement;
    let profitPieStateCache = {};
    let previousBaselineY = 0;
    let hasResizeListeners = false;
    let lastDrawTime = 0;

    function draw(isResize = false) {
        const svg = d3.select("#profit-panel");

        // If resizing, temporarily collapse the SVG to 0x0.
        if (isResize) {
            svg.attr("width", 0).attr("height", 0);
            svg.selectAll("g#profit-root").remove();
        }

        // --- INITIAL SETUP ---
        const container = document.getElementById('svg-container');
        const { clientWidth: width, clientHeight: height } = container;
        svg.attr("width", width).attr("height", height);

        const rootG = svg.selectAll("g#profit-root").data([null]).join("g").attr("id", "profit-root");

        if (svg.select("defs").empty()) svg.append("defs");
        const defs = svg.select("defs");

        const viewportW = Math.max(320, width);
        const uiScale = Math.max(0.8, Math.min(2.0, viewportW / 1440));

        const sizes = {
            title: 14 * uiScale,
            subtitle: 13 * uiScale,
            axis: 11 * uiScale,
            body: 12 * uiScale,
            small: 10 * uiScale
        };

        document.documentElement.style.setProperty('--profit-ui-scale', uiScale);

        // Add resize listeners if not already added
        if (!hasResizeListeners) {
            document.getElementById('left-sidebar').addEventListener('transitionend', (event) => {
                if (event.propertyName === 'width') draw();
            });
            document.getElementById('right-sidebar').addEventListener('transitionend', (event) => {
                if (event.propertyName === 'width') draw();
            });
            hasResizeListeners = true;
        }

        // Standard transition used for axis & shape animations
        const baseDuration = isResize ? 0 : 750;
        const t = d3.transition().duration(baseDuration).ease(d3.easeCubicOut);

        const data = profitMaximizationCache.data;

        // --- LAYOUT GEOMETRY ---
        const legendSpace = 70 * uiScale;

        const margin = {
            top: 30 * uiScale,
            right: 40 * uiScale,
            bottom: 45 * uiScale,
            left: 80 * uiScale
        };

        const calculatedBreakdownW = Math.max(280 * uiScale, width * 0.32);
        const breakdownWidth = Math.min(width * 0.40, calculatedBreakdownW);

        const chartsWidth = width - breakdownWidth;
        const chartWidth = chartsWidth - margin.left - margin.right;

        const availableChartVerticalSpace = height - margin.top - margin.bottom - legendSpace;
        const chartHeight = availableChartVerticalSpace / 2;

        const chartsGroup = rootG.selectAll("g.charts-group").data([null]).join("g").attr("class", "charts-group");
        const breakdownGroup = rootG.selectAll("g.breakdown-group").data([null]).join("g").attr("class", "breakdown-group").attr("transform", `translate(${chartsWidth},0)`);

        // --- INPUTS / METRICS ---
        const op = {
            dailyDemand: +dailyDemandInput.value,
            opHours: +opHoursInput.value,
            numEmployees: +numEmployeesInput.value
        };

        const fin = {
            laborCost: +laborCostInput.value,
            superSell: +superSellInput.value,
            superCogs: +superCogsInput.value,
            ultraSell: +ultraSellInput.value,
            ultraCogs: +ultraCogsInput.value,
            megaSell: +megaSellInput.value,
            megaCogs: +megaCogsInput.value,
            superRework: +superReworkInput.value,
            ultraRework: +ultraReworkInput.value,
            megaRework: +megaReworkInput.value
        };

        const m = calculateMetrics(op, fin);

        const x = d3.scaleLinear().domain([50, 552]).range([0, chartWidth]).clamp(true);

        const currentProfit = m.dailyGrossProfit;
        const yProfit = d3.scaleLinear()
            .domain([
                Math.min(currentProfit, d3.min(data.profitData, d => d.value)),
                Math.max(currentProfit, d3.max(data.profitData, d => d.value))
            ])
            .nice()
            .range([chartHeight, 0]);

        const filteredMarginData = data.marginData.filter(d => d.demand > 50);
        const yMargin = d3.scaleLinear()
            .domain([
                Math.min(m.grossProfitMargin, d3.min(filteredMarginData, d => d.value)),
                Math.max(m.grossProfitMargin, d3.max(filteredMarginData, d => d.value))
            ])
            .nice()
            .range([chartHeight, 0]);

        // --- HELPERS ---
        const bisect = d3.bisector(d => d.demand).left;
        const fmtMoney = d3.format("$,.0f");
        const fmtPct = v => `${d3.format(".1f")(v)}%`;

        const actX = x(m.throughputUnitsPerDay);

        const tooltip = createTooltip('profit-tooltip').style("position", "fixed");
        const showTT = (html, ev) => tooltip.html(html).style("opacity", 1)
            .style("left", (ev.clientX + 14) + "px")
            .style("top", (ev.clientY - 24) + "px");
        const hideTT = () => tooltip.style("opacity", 0);

        const unmetExists = op.dailyDemand > m.throughputUnitsPerDay;

        const optimalProfitAtCurrentDemand = data.profitData[Math.max(0, bisect(data.profitData, op.dailyDemand, 1) - 1)].value;
        const currentDemandLostProfit = Math.max(0, optimalProfitAtCurrentDemand - m.dailyGrossProfit);

        const missedProfitTooltipHtml = `<div class="tooltip-header">Missed Profit</div>
            <div class="tooltip-row"><span class="tooltip-key">Max Throughput</span><span>${m.throughputUnitsPerDay.toFixed(0)} units</span></div>
            <div class="tooltip-row"><span class="tooltip-key">Lost Profit</span><span>${fmtMoney(currentDemandLostProfit)}</span></div>`;

        function drawAxesWithGrid(g, xScale, yScale, isProfit, transition) {
            const yGrid = g.selectAll("g.grid-major-y").data([null]).join("g").attr("class", "grid-major grid-major-y");
            if (transition) yGrid.transition(transition).call(d3.axisLeft(yScale).ticks(8).tickSizeOuter(0).tickSize(-chartWidth).tickFormat(""));
            else yGrid.call(d3.axisLeft(yScale).ticks(8).tickSizeOuter(0).tickSize(-chartWidth).tickFormat(""));
            yGrid.selectAll("text").attr("font-size", sizes.small);

            const xGrid = g.selectAll("g.grid-major-x").data([null]).join("g").attr("class", "grid-major grid-major-x").attr("transform", `translate(0,${chartHeight})`);
            if (transition) xGrid.transition(transition).call(d3.axisBottom(xScale).ticks(12).tickSizeOuter(0).tickSize(-chartHeight).tickFormat(""));
            else xGrid.call(d3.axisBottom(xScale).ticks(12).tickSizeOuter(0).tickSize(-chartHeight).tickFormat(""));
            xGrid.selectAll("text").attr("font-size", sizes.small);

            const xAxis = g.selectAll("g.axis.x-axis").data([null]).join("g").attr("class", "axis x-axis").attr("transform", `translate(0,${chartHeight})`);
            if (transition) xAxis.transition(transition).call(d3.axisBottom(xScale).ticks(12).tickSizeOuter(0).tickFormat(d3.format("d")));
            else xAxis.call(d3.axisBottom(xScale).ticks(12).tickSizeOuter(0).tickFormat(d3.format("d")));
            xAxis.selectAll("text").attr("font-size", sizes.axis);

            const yAxis = g.selectAll("g.axis.y-axis").data([null]).join("g").attr("class", "axis y-axis");
            if (transition) yAxis.transition(transition).call(d3.axisLeft(yScale).ticks(6).tickSizeOuter(0).tickFormat(isProfit ? fmtMoney : d => fmtPct(d)));
            else yAxis.call(d3.axisLeft(yScale).ticks(6).tickSizeOuter(0).tickFormat(isProfit ? fmtMoney : d => fmtPct(d)));
            yAxis.selectAll("text").attr("font-size", sizes.axis);
        }

        // ============================================================
        // 1. PROFIT CHART (TOP)
        // ============================================================
        const gP = chartsGroup.selectAll("g.profit-chart").data([null]).join("g").attr("class", "profit-chart").attr("transform", `translate(${margin.left},${margin.top})`);
        drawAxesWithGrid(gP, x, yProfit, true, t);

        const vGuideP = gP.selectAll("line.crosshair").data([null]).join("line").attr("class", "crosshair").style("display", "none");
        const hGuideP = gP.selectAll("line.crosshair-h").data([null]).join("line").attr("class", "crosshair-h").style("display", "none");
        const vGuideP2 = gP.selectAll("line.crosshair-2").data([null]).join("line").attr("class", "crosshair crosshair-2").style("display", "none");
        const hGuideP2 = gP.selectAll("line.crosshair-h-2").data([null]).join("line").attr("class", "crosshair-h crosshair-h-2").style("display", "none");

        const profitHoverRect = gP.selectAll("rect.profit-hover").data([null]).join("rect")
            .attr("class", "profit-hover")
            .attr("width", chartWidth)
            .attr("height", chartHeight)
            .attr("fill", "transparent")
            .style("pointer-events", "all");

        gP.selectAll("path.profit-line-profit").data([data.profitData.filter(d => d.demand > 50)]).join("path")
            .attr("class", "profit-line-profit")
            .attr("fill", "none");
        gP.selectAll("path.profit-line-profit").transition(t).attr("d", d3.line().x(d => x(d.demand)).y(d => yProfit(d.value)));

        const y_at_act_profit = yProfit(data.profitData[Math.max(0, bisect(data.profitData, m.throughputUnitsPerDay, 1) - 1)].value);
        const y_current_profit = yProfit(m.dailyGrossProfit);

        gP.selectAll("line.profit-connector-line").data([null]).join("line").attr("class", "profit-connector-line")
            .attr("x1", actX).attr("x2", actX);
        gP.selectAll("line.profit-connector-line").transition(t).attr("y1", y_at_act_profit).attr("y2", y_current_profit);

        if (unmetExists) {
            const profitAreaGenerator = d3.area()
                .x(d => x(d.demand))
                .y1(d => yProfit(d.value))
                .y0(y_current_profit);

            const startIndex = Math.max(0, bisect(data.profitData, m.throughputUnitsPerDay, 1) - 1);
            const endIndex = bisect(data.profitData, op.dailyDemand, 1);
            const areaData = data.profitData.slice(startIndex, endIndex + 1);
            const startPoint = { demand: m.throughputUnitsPerDay, value: yProfit.invert(y_at_act_profit) };
            const endPoint = { demand: op.dailyDemand, value: yProfit.invert(yProfit(data.profitData[Math.max(0, bisect(data.profitData, op.dailyDemand, 1) - 1)].value)) };

            gP.selectAll("path.lost-profit-area").data([[startPoint, ...areaData.filter(d => d.demand > m.throughputUnitsPerDay && d.demand < op.dailyDemand), endPoint]]).join("path")
                .attr("class", "lost-profit-area")
                .on("mousemove", (ev) => showTT(missedProfitTooltipHtml, ev))
                .on("mouseleave", hideTT);
            gP.selectAll("path.lost-profit-area").transition(t).attr("d", profitAreaGenerator);
        } else {
            gP.selectAll("path.lost-profit-area").remove();
        }

        const pointSel = gP.selectAll("circle.point-now").data([null]).join("circle")
            .attr("class", "point-now")
            .attr("cx", actX)
            .attr("r", 5 * uiScale)
            .on("mouseenter", (ev) => {
                if (unmetExists) {
                    showTT(missedProfitTooltipHtml, ev);
                } else {
                    showTT(
                        `<div class="tooltip-header">Current Profit</div>
                        <div class="tooltip-row"><span class="tooltip-key">Value</span><span>${fmtMoney(m.dailyGrossProfit)}</span></div>
                        <div class="tooltip-row"><span class="tooltip-key">Throughput</span><span>${m.throughputUnitsPerDay.toFixed(0)} units</span></div>`,
                        ev);
                }
            })
            .on("mouseleave", hideTT);
        pointSel.transition(t).attr("cy", y_current_profit);

        gP.selectAll("text.profit-title").data([null]).join("text")
            .attr("class", "profit-title")
            .attr("x", chartWidth / 2)
            .attr("y", -10 * uiScale)
            .attr("text-anchor", "middle")
            .attr("font-size", sizes.title)
            .attr("font-weight", "bold")
            .text("Max Gross Profit vs Daily Demand");

        profitHoverRect.on("mousemove", (ev) => {
            const demandHover = Math.round(x.invert(d3.pointer(ev)[0]));
            const idx = Math.max(0, bisect(data.profitData, demandHover, 1) - 1);
            const d = data.profitData[idx];
            if (!d) return;

            vGuideP.style("display", null).attr("x1", x(d.demand)).attr("x2", x(d.demand)).attr("y1", 0).attr("y2", chartHeight);
            hGuideP.style("display", null).attr("x1", 0).attr("x2", chartWidth).attr("y1", yProfit(d.value)).attr("y2", yProfit(d.value));
            vGuideP2.style("display", null).attr("x1", x(d.demand)).attr("x2", x(d.demand)).attr("y1", 0).attr("y2", chartHeight);
            hGuideP2.style("display", null).attr("x1", 0).attr("x2", chartWidth).attr("y1", yProfit(d.value)).attr("y2", yProfit(d.value));

            showTT(
                `<div class="tooltip-header">Demand: ${demandHover}</div>
                <div class="tooltip-row"><span class="tooltip-key">Optimal Profit</span><span>${fmtMoney(d.value)}</span></div>
                <div class="tooltip-row"><span class="tooltip-key"># Workstations</span><span>${d.config.emp}</span></div>
                <div class="tooltip-row"><span class="tooltip-key">Oper Hours</span><span>${d.config.hrs}</span></div>`,
                ev
            );
        }).on("mouseleave", () => {
            vGuideP.style("display", "none");
            hGuideP.style("display", "none");
            vGuideP2.style("display", "none");
            hGuideP2.style("display", "none");
            hideTT();
        });


        // ============================================================
        // 2. LEGEND (SCALED & BOUND)
        // ============================================================
        const legendY = margin.top + chartHeight + (legendSpace / 2) + (5 * uiScale);
        const legendG = chartsGroup.selectAll("g.legend-group").data([null]).join("g").attr("class", "legend-group");

        const legItems = [
            { type: 'icon', class: 'point-now', shape: 'circle', label: "Current profit/margin" },
            { type: 'icon', class: 'lost-profit-area', shape: 'rect', label: "Unmet demand" },
            { type: 'text', class: 'text-only', label: "Demand < 50: Use 3-Workstation Config", color: getComputedStyle(root).getPropertyValue('--secondary1').trim() }
        ];

        const legendContent = legendG.selectAll("g.legend-content").data([null]).join("g").attr("class", "legend-content");

        let currentX = 0;
        const itemGap = 30 * uiScale;
        const boxPaddingX = 15 * uiScale;
        const boxPaddingY = 8 * uiScale;

        const legendBg = legendContent.selectAll("rect.legend-bg").data([null]).join("rect").attr("class", "legend-bg")
            .attr("fill", "none")
            .attr("stroke", getComputedStyle(root).getPropertyValue('--accent').trim())
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "4 2")
            .attr("rx", 4);

        const itemGroup = legendContent.selectAll("g.item-group").data([null]).join("g").attr("class", "item-group");
        const measurer = svg.append("text").attr("font-size", sizes.body).style("opacity", 0);

        const legItemsWithPos = legItems.map(item => {
            measurer.text(item.label);
            const textW = measurer.node().getComputedTextLength();
            const iconW = item.type === 'icon' ? 12 * uiScale : 0;
            const spacing = item.type === 'icon' ? 6 * uiScale : 0;
            const totalItemW = iconW + spacing + textW;
            const xPos = currentX;
            currentX += totalItemW + itemGap;
            return { ...item, x: xPos };
        });

        const legendItemsSel = itemGroup.selectAll("g.legend-item").data(legItemsWithPos, d => d.label);
        const legendItemsEnter = legendItemsSel.enter().append("g").attr("class", "legend-item");
        const legendItemsMerge = legendItemsEnter.merge(legendItemsSel);
        legendItemsMerge.attr("transform", d => `translate(${d.x},0)`);
        legendItemsEnter.each(function (d) {
            const g = d3.select(this);
            if (d.type === 'icon') {
                if (d.shape === 'circle') {
                    g.append("circle").attr("class", d.class).attr("r", 5 * uiScale).attr("cx", 5 * uiScale).attr("cy", -uiScale);
                } else {
                    g.append("rect").attr("class", d.class).attr("x", 0).attr("y", -6 * uiScale).attr("width", 10 * uiScale).attr("height", 10 * uiScale);
                }
                g.append("text").attr("x", 16 * uiScale).attr("y", sizes.body / 4).attr("font-size", sizes.body).attr("fill", getComputedStyle(root).getPropertyValue('--accent').trim()).text(d.label);
            } else {
                g.append("text").attr("x", 0).attr("y", sizes.body / 4).attr("font-size", sizes.body).attr("font-weight", "bold").attr("fill", d.color).text(d.label);
            }
        });
        legendItemsSel.exit().remove();
        measurer.remove();

        const totalLegendContentWidth = currentX - itemGap;

        legendBg
            .attr("x", -boxPaddingX)
            .attr("y", -boxPaddingY - (sizes.body / 4))
            .attr("width", totalLegendContentWidth + (boxPaddingX * 3))
            .attr("height", (sizes.body) + (boxPaddingY));

        const fullLegendWidth = totalLegendContentWidth + (boxPaddingX * 2);

        let legendScale = 1;
        if (fullLegendWidth > chartWidth) {
            legendScale = chartWidth / fullLegendWidth;
        }

        const centeredX = margin.left + (chartWidth - (fullLegendWidth * legendScale)) / 2;

        legendG.attr("transform", `translate(${centeredX}, ${legendY}) scale(${legendScale})`);
        legendContent.attr("transform", `translate(${boxPaddingX}, 0)`);


        // ============================================================
        // 3. MARGIN CHART (BOTTOM)
        // ============================================================
        const bottomChartY = margin.top + chartHeight + (legendSpace * 1.1);

        const gM = chartsGroup.selectAll("g.margin-chart").data([null]).join("g").attr("class", "margin-chart").attr("transform", `translate(${margin.left},${bottomChartY})`);
        drawAxesWithGrid(gM, x, yMargin, false, t);

        const vGuideM = gM.selectAll("line.crosshair").data([null]).join("line").attr("class", "crosshair").style("display", "none");
        const hGuideM = gM.selectAll("line.crosshair-h").data([null]).join("line").attr("class", "crosshair-h").style("display", "none");

        const marginHoverRect = gM.selectAll("rect.margin-hover").data([null]).join("rect")
            .attr("class", "margin-hover")
            .attr("width", chartWidth)
            .attr("height", chartHeight)
            .attr("fill", "transparent")
            .style("pointer-events", "all");

        const marginLineSel = gM.selectAll("path.profit-line-margin").data([filteredMarginData]).join("path")
            .attr("class", "profit-line-margin")
            .attr("fill", "none");
        marginLineSel.transition(t).attr("d", d3.line().x(d => x(d.demand)).y(d => yMargin(d.value)));

        const y_at_act_margin = yMargin(data.marginData[Math.max(0, bisect(data.marginData, m.throughputUnitsPerDay, 1) - 1)].value);
        const y_current_margin = yMargin(m.grossProfitMargin);

        gM.selectAll("line.profit-connector-line").data([null]).join("line").attr("class", "profit-connector-line")
            .attr("x1", actX).attr("x2", actX)
            .attr("y1", y_at_act_margin).attr("y2", y_current_margin);

        if (unmetExists) {
            const marginAreaGenerator = d3.area()
                .x(d => x(d.demand))
                .y1(d => yMargin(d.value))
                .y0(y_current_margin);

            const startIndex = Math.max(0, bisect(data.marginData, m.throughputUnitsPerDay, 1) - 1);
            const endIndex = bisect(data.marginData, op.dailyDemand, 1);
            const areaData = data.marginData.slice(startIndex, endIndex + 1);
            const startPoint = { demand: m.throughputUnitsPerDay, value: yMargin.invert(y_at_act_margin) };
            const endPoint = { demand: op.dailyDemand, value: yMargin.invert(yMargin(data.marginData[Math.max(0, bisect(data.marginData, op.dailyDemand, 1) - 1)].value)) };

            gM.selectAll("path.lost-profit-area").data([[startPoint, ...areaData.filter(d => d.demand > m.throughputUnitsPerDay && d.demand < op.dailyDemand), endPoint]]).join("path")
                .attr("class", "lost-profit-area")
                .attr("d", marginAreaGenerator)
                .on("mousemove", (ev) => showTT(missedProfitTooltipHtml, ev))
                .on("mouseleave", hideTT);
        } else {
            gM.selectAll("path.lost-profit-area").remove();
        }

        const pM = gM.selectAll("circle.point-now").data([null]).join("circle")
            .attr("class", "point-now")
            .attr("cx", actX)
            .attr("r", 5 * uiScale)
            .on("mouseenter", (ev) => {
                if (unmetExists) {
                    showTT(missedProfitTooltipHtml, ev);
                } else {
                    showTT(
                        `<div class="tooltip-header">Current Margin</div>
                        <div class="tooltip-row"><span class="tooltip-key">Value</span><span>${fmtPct(m.grossProfitMargin)}</span></div>
                        <div class="tooltip-row"><span class="tooltip-key">Throughput</span><span>${m.throughputUnitsPerDay.toFixed(0)} units</span></div>`,
                        ev);
                }
            })
            .on("mouseleave", hideTT);
        pM.transition(t).attr("cy", y_current_margin);

        gM.selectAll("text.margin-title").data([null]).join("text")
            .attr("class", "margin-title")
            .attr("x", chartWidth / 2)
            .attr("y", -10 * uiScale)
            .attr("text-anchor", "middle")
            .attr("font-size", sizes.title)
            .attr("font-weight", "bold")
            .text("Max Gross Profit Margin vs Daily Demand");

        gM.selectAll("text.margin-x-label").data([null]).join("text")
            .attr("class", "margin-x-label")
            .attr("x", chartWidth / 2)
            .attr("y", chartHeight + (margin.bottom - (12 * uiScale)))
            .attr("text-anchor", "middle")
            .attr("font-size", sizes.axis)
            .attr("font-weight", "bold")
            .text("Daily Demand (units)");

        marginHoverRect.on("mousemove", (ev) => {
            const demandHover = Math.round(x.invert(d3.pointer(ev)[0]));
            const idxM = Math.max(0, bisect(data.marginData, demandHover, 1) - 1);
            const dM = data.marginData[idxM];
            if (!dM) return;

            vGuideM.style("display", null).attr("x1", x(dM.demand)).attr("x2", x(dM.demand)).attr("y1", 0).attr("y2", chartHeight);
            hGuideM.style("display", null).attr("x1", 0).attr("x2", chartWidth).attr("y1", yMargin(dM.value)).attr("y2", yMargin(dM.value));
            showTT(
                `<div class="tooltip-header">Demand: ${demandHover}</div>
                <div class="tooltip-row"><span class="tooltip-key">Optimal Margin</span><span>${fmtPct(dM.value)}</span></div>
                <div class="tooltip-row"><span class="tooltip-key"># Workstations</span><span>${dM.config.emp}</span></div>
                <div class="tooltip-row"><span class="tooltip-key">Oper Hours</span><span>${dM.config.hrs}</span></div>`,
                ev
            );
        }).on("mouseleave", () => {
            vGuideM.style("display", "none");
            hGuideM.style("display", "none");
            hideTT();
        });


        // ============================================================
        // 4. BREAKDOWN PANEL (RIGHT SIDE)
        // ============================================================
        const totalLabor = op.numEmployees * op.opHours * fin.laborCost;
        const qualityYield = m.qualityYield;
        const totalStress = 1.0 - qualityYield;

        const BUILD_RATIOS = window.BUILD_RATIOS || { super: 1 / 3, ultra: 1 / 3, mega: 1 / 3 };

        const perModel = ["super", "ultra", "mega"].map(key => {
            const units = m.throughputUnitsPerDay * BUILD_RATIOS[key];
            const failedUnits = units * totalStress;
            const sales = units * fin[`${key}Sell`];
            const cogs = units * fin[`${key}Cogs`];
            const labor = totalLabor * BUILD_RATIOS[key];
            const rework = failedUnits * fin[`${key}Rework`];
            const totalCost = cogs + labor + rework;
            const netRevenue = sales;
            const profit = netRevenue - totalCost;

            return {
                label: key[0].toUpperCase() + key.slice(1),
                sales: sales,
                cogs: cogs,
                labor: labor,
                rework: rework,
                totalCost: totalCost,
                netRevenue: netRevenue,
                profit: profit,
                margin: netRevenue > 0 ? (profit / netRevenue) * 100 : 0
            };
        });

        const totalProfit = d3.sum(perModel, d => d.profit);
        const totalSales = d3.sum(perModel, d => d.sales);
        const totalCosts = d3.sum(perModel, d => d.totalCost);

        const pad = Math.max(10 * uiScale, breakdownWidth * 0.05);

        const rightTotalH = height;
        const pieSectionHeight = rightTotalH * 0.57;
        const barSectionHeight = rightTotalH * 0.43;

        // ---------- PART A: ADVANCED PIE CHARTS ----------
        const topHalf = breakdownGroup.selectAll("g.top-half").data([null]).join("g").attr("class", "top-half");

        topHalf.selectAll("rect.breakdown-border").data([null]).join("rect")
            .attr("class", "breakdown-border")
            .attr("x", pad / 2).attr("y", pad / 2)
            .attr("width", Math.max(0, breakdownWidth - pad))
            .attr("height", pieSectionHeight - pad);

        topHalf.selectAll("text.breakdown-title").data([null]).join("text")
            .attr("class", "breakdown-title")
            .attr("x", pad / 2 + (breakdownWidth - pad) / 2)
            .attr("y", pad / 2 + 20 * uiScale)
            .attr("text-anchor", "middle")
            .attr("font-size", sizes.subtitle)
            .attr("font-weight", "bold")
            .text("Financial Breakdown by Area");

        const pieColors = {
            Profit: getComputedStyle(root).getPropertyValue('--primary').trim(),
            Rework: getComputedStyle(root).getPropertyValue('--failure-color').trim(),
            Labor: getComputedStyle(root).getPropertyValue('--secondary1').trim(),
            Material: getComputedStyle(root).getPropertyValue('--secondary2').trim()
        };

        const innerW = breakdownWidth - 2 * pad;
        const innerH = pieSectionHeight - 2 * pad;

        const ttPie = createTooltip('profit-pie-tooltip');

        const pieDataList = [
            {
                title: "Overall",
                modelData: perModel,
                sales: totalSales,
                costs: totalCosts,
                profit: totalProfit,
                margin: m.grossProfitMargin
            },
            ...perModel.map(d => ({
                title: d.label,
                modelData: [d],
                sales: d.sales,
                costs: d.totalCost,
                profit: d.profit,
                margin: d.margin
            }))
        ];

        const cols = 2;
        const rowPositions = [0.3, 0.74];
        const cellW = innerW / cols;
        const cellH = innerH / (pieDataList.length > 2 ? 2 : 1);

        const maxFinancialValue = d3.max(pieDataList, d => Math.max(0, d.sales, d.costs));
        const maxRadius = Math.min(cellW, cellH) * 0.4;

        const radiusScale = d3.scaleSqrt()
            .domain([0, maxFinancialValue])
            .range([0, maxRadius])
            .clamp(true);

        const anglePie = d3.pie().value(d => d.value).sort(null);
        const halfPadding = 0.05;

        function drawAdvancedPieChart(g, data, isLoss, maxR) {
            const { sales, costs, profit, modelData, title, margin } = data;

            // Calculate radii
            const R_profit = radiusScale(Math.max(0, profit));
            const R_revenue = radiusScale(sales);
            const R_costs = radiusScale(costs); // Used for scaling the outer ring loss area

            const pieAnimDur = 750;

            // --- 1. Inner Ring: Profit Circle ---
            const innerRadiusStart = Math.max(0, R_profit);
            const prevState = profitPieStateCache && profitPieStateCache[title] ? profitPieStateCache[title] : null;
            const prevCenterR = prevState ? (prevState.centerR || 0) : 0;

            if (profit > 0) {
                const centerSel = g.selectAll("circle.profit-center-circle").data([profit]);
                const centerEnter = centerSel.enter().append("circle")
                    .attr("class", "profit-pie-slice profit-center-circle")
                    .attr("r", prevCenterR)
                    .attr("fill", pieColors.Profit)
                    .on("mousemove", (ev) => ttPie.html(
                        `<div class="tooltip-header">${title}: Profit</div>
                        <div class="tooltip-row"><span class="tooltip-key">Profit</span><span>${fmtMoney(profit)}</span></div>
                        <div class="tooltip-row"><span class="tooltip-key">Margin</span><span>${fmtPct(margin)}</span></div>`
                    ).style("left", (ev.clientX + 14) + "px").style("top", (ev.clientY - 24) + "px").style("opacity", 1))
                    .on("mouseleave", () => ttPie.style("opacity", 0));

                const centerMerged = centerEnter.merge(centerSel);
                if (isResize) {
                    centerMerged.attr("r", R_profit);
                    centerMerged.each(function (d) { this._currentR = R_profit; });
                } else {
                    centerMerged.transition().duration(pieAnimDur).attrTween("r", function (d) {
                        const startR = (typeof this._currentR !== 'undefined') ? this._currentR : prevCenterR || 0;
                        const i = d3.interpolate(startR, R_profit);
                        this._currentR = R_profit;
                        return t => i(t);
                    });
                }
                centerSel.exit().transition().duration(pieAnimDur).attrTween("r", function () {
                    const startR = (typeof this._currentR !== 'undefined') ? this._currentR : R_profit;
                    const i = d3.interpolate(startR, 0);
                    this._currentR = 0;
                    return t => i(t);
                }).remove();
            } else {
                g.selectAll("circle.profit-center-circle").data([]).exit().remove();
            }

            // --- 2. Middle Ring: Covered Costs Breakdown ---
            if (R_revenue > innerRadiusStart) {
                const totalCostsData = modelData.reduce((acc, d) => {
                    acc.Labor += d.labor;
                    acc.Material += d.cogs;
                    acc.Rework += d.rework;
                    return acc;
                }, { Labor: 0, Material: 0, Rework: 0 });

                const middleRingData = Object.entries(totalCostsData)
                    .map(([label, value]) => ({ label, value }))
                    .filter(d => d.value > 1e-6);

                const midInner = innerRadiusStart + (innerRadiusStart > 0 ? (3 * uiScale) : uiScale);
                const midOuter = R_revenue - (3 * uiScale);

                const arcMiddle = d3.arc()
                    .innerRadius(d => d.innerRadius)
                    .outerRadius(d => d.outerRadius)
                    .padAngle(halfPadding);

                const midData = anglePie(middleRingData).map(d => ({ ...d, innerRadius: midInner, outerRadius: midOuter }));

                const midSel = g.selectAll("path.middle-arc").data(midData, d => d.data.label);
                const midEnter = midSel.enter().append("path")
                    .attr("class", "profit-pie-slice middle-arc")
                    .attr("fill", d => pieColors[d.data.label])
                    .each(function (d) {
                        const prevArc = prevState && prevState.middle && prevState.middle[d.data && d.data.label ? d.data.label : d.index];
                        if (prevArc) {
                            this._current = { ...prevArc };
                        } else {
                            this._current = { startAngle: d.startAngle, endAngle: d.startAngle, innerRadius: midInner, outerRadius: midInner };
                        }
                    })
                    .attr("d", function (d) { return arcMiddle(this._current); });

                const midMerged = midEnter.merge(midSel);

                if (isResize) {
                    midMerged.attr("d", d => arcMiddle({ startAngle: d.startAngle, endAngle: d.endAngle, innerRadius: midInner, outerRadius: midOuter }));
                } else {
                    midMerged.transition("shape").duration(pieAnimDur).attrTween("d", function (d) {
                        const final = { startAngle: d.startAngle, endAngle: d.endAngle, innerRadius: midInner, outerRadius: midOuter };
                        const i = d3.interpolate(this._current || final, final);
                        this._current = i(1);
                        return t => arcMiddle(i(t));
                    });
                }

                midMerged.on("mousemove", (ev, d) => {
                    const totalCostByType = d.data.value;
                    const share = sales > 0 ? (totalCostByType / sales * 100) : 0;
                    ttPie.html(
                        `<div class="tooltip-header">${title}: ${d.data.label}</div>
                        <div class="tooltip-row"><span class="tooltip-key">Total Cost</span><span>${fmtMoney(totalCostByType)}</span></div>
                        <div class="tooltip-row"><span class="tooltip-key">% of Revenue</span><span>${share.toFixed(1)}%</span></div>`
                    ).style("left", (ev.clientX + 14) + "px").style("top", (ev.clientY - 24) + "px").style("opacity", 1);
                }).on("mouseleave", () => ttPie.style("opacity", 0));

                if (isResize) {
                    midSel.exit().attr("d", d => arcMiddle({ startAngle: d.startAngle, endAngle: d.startAngle, innerRadius: midInner, outerRadius: midInner })).remove();
                } else {
                    midSel.exit().transition().duration(pieAnimDur).attrTween("d", function (d) {
                        const end = { startAngle: d.startAngle, endAngle: d.startAngle, innerRadius: midInner, outerRadius: midInner };
                        const i = d3.interpolate(this._current || end, end);
                        this._current = i(1);
                        return t => arcMiddle(i(t));
                    }).remove();
                }
            }

            // --- 3. Outer Ring: Unrecovered Costs ---
            const unrecoveredCost = costs - sales;

            let outData = [];
            let outOuter = 0;
            let arcOuter = null;

            // Only visible/calculated if profit is negative.
            if (profit < 0) {
                const totalCostsData = modelData.reduce((acc, d) => {
                    acc.Labor += d.labor;
                    acc.Material += d.cogs;
                    acc.Rework += d.rework;
                    return acc;
                }, { Labor: 0, Material: 0, Rework: 0 });

                const outerRingData = Object.entries(totalCostsData)
                    .map(([label, value]) => ({ label, value }))
                    .filter(d => d.value > 1e-6);

                const outInner = R_revenue + (1 * uiScale);
                // Scale outer radius based on Total Expenses (R_costs)
                outOuter = Math.max(R_costs, outInner + (2 * uiScale));

                arcOuter = d3.arc()
                    .innerRadius(d => d.innerRadius)
                    .outerRadius(d => d.outerRadius)
                    .padAngle(halfPadding);

                outData = anglePie(outerRingData).map(d => ({ ...d, innerRadius: outInner, outerRadius: outOuter }));
            }

            const outSel = g.selectAll("path.outer-arc").data(outData, d => d.data.label);

            const outEnter = outSel.enter().append("path")
                .attr("class", "profit-pie-slice outer-arc")
                .each(function (d) {
                    const prevArc = prevState && prevState.outer && prevState.outer[d.data && d.data.label ? d.data.label : d.index];
                    if (prevArc) {
                        this._current = { ...prevArc };
                    } else {
                        this._current = { startAngle: d.startAngle, endAngle: d.startAngle, innerRadius: d.innerRadius, outerRadius: d.outerRadius };
                    }
                })
                .attr("d", function (d) { return arcOuter ? arcOuter(this._current) : ""; });

            const outMerged = outEnter.merge(outSel);
            outMerged
                .attr("fill", d => pieColors[d.data.label])
                .style("opacity", 0.3)
                .classed("blinking-failure", true);

            if (isResize) {
                outMerged.attr("d", d => arcOuter({ startAngle: d.startAngle, endAngle: d.endAngle, innerRadius: d.innerRadius, outerRadius: d.outerRadius }));
            } else {
                outMerged.transition("shape").duration(pieAnimDur).attrTween("d", function (d) {
                    const final = { startAngle: d.startAngle, endAngle: d.endAngle, innerRadius: d.innerRadius, outerRadius: d.outerRadius };
                    const i = d3.interpolate(this._current || final, final);
                    this._current = i(1);
                    return t => arcOuter ? arcOuter(i(t)) : "";
                });
            }

            // Using 'event' explicitly to prevent ReferenceErrors
            outMerged.on("mousemove", (event) => {
                const lossMarginDisplay = d3.format(".1f")(margin);
                ttPie.html(
                    `<div class="tooltip-header">${title}: Unrecovered Costs</div>
                    <div class="tooltip-row"><span class="tooltip-key">Unrecovered</span><span>${fmtMoney(unrecoveredCost)}</span></div>
                    <div class="tooltip-row"><span class="tooltip-key">Loss Margin</span><span>${lossMarginDisplay}%</span></div>`
                ).style("left", (event.clientX + 14) + "px").style("top", (event.clientY - 24) + "px").style("opacity", 1);
            })
                .on("mouseleave", () => ttPie.style("opacity", 0));

            if (isResize) {
                outSel.exit().remove();
            } else {
                outSel.exit().transition().duration(pieAnimDur).style("opacity", 0).remove();
            }

            // Draw a final border/marker for the largest radius achieved
            const finalArcRadius = Math.max(R_profit, R_revenue, outOuter);

            const outerArcBorder = d3.arc().innerRadius(d => d.innerRadius).outerRadius(d => d.outerRadius);

            if (finalArcRadius > 0) {
                const borderSel = g.selectAll("path.profit-pie-border").data([{ innerRadius: finalArcRadius, outerRadius: finalArcRadius + 1.5 * uiScale }]);
                const borderEnter = borderSel.enter().append("path")
                    .attr("class", "profit-pie-border")
                    .attr("d", outerArcBorder({ innerRadius: 0, outerRadius: 0, startAngle: 0, endAngle: 2 * Math.PI }));
                const borderMerged = borderEnter.merge(borderSel);
                borderMerged
                    .classed("blinking-failure", unrecoveredCost > 0)
                    .attr("d", d => outerArcBorder({ innerRadius: d.innerRadius, outerRadius: d.outerRadius, startAngle: 0, endAngle: 2 * Math.PI }));
                borderSel.exit().remove();
            }
        }

        // --- DRAW ALL PIE CHARTS ---
        const pieCells = topHalf.selectAll("g.pie-cell").data(pieDataList, d => d.title);
        const pieEnter = pieCells.enter().append("g").attr("class", "pie-cell").attr("data-profit-title", d => d.title);
        const pieMerge = pieEnter.merge(pieCells);
        pieMerge.each(function (d, i) {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const cx = pad + cellW * (col + 0.5);
            const cy = pad + innerH * rowPositions[row];
            const g = d3.select(this).attr("transform", `translate(${cx}, ${cy})`).attr("data-profit-title", d.title);
            const isLoss = d.profit < 0;
            drawAdvancedPieChart(g, d, isLoss, maxRadius);
            const titleSel = g.selectAll("text.pie-title").data([d.title]).join("text").attr("class", "pie-title")
                .attr("y", -maxRadius - (8 * uiScale))
                .attr("text-anchor", "middle")
                .attr("font-size", sizes.body)
                .attr("font-weight", "bold")
                .text(pd => pd);
        });
        pieCells.exit().remove();

        try {
            const newCache = {};
            d3.selectAll('#profit-panel g[data-profit-title]').each(function () {
                const g = d3.select(this);
                const title = g.attr('data-profit-title');
                if (!title) return;
                const p = { centerR: 0, middle: {}, outer: {} };
                const centerNode = this.querySelector('circle.profit-center-circle');
                if (centerNode) p.centerR = (centerNode._currentR || +d3.select(centerNode).attr('r') || 0);
                g.selectAll('path.middle-arc').each(function (d) {
                    const lbl = d.data && d.data.label ? d.data.label : (d.index || 'slice');
                    p.middle[lbl] = this._current || null;
                });
                g.selectAll('path.outer-arc').each(function (d) {
                    const lbl = d.data && d.data.label ? d.data.label : (d.index || 'slice');
                    p.outer[lbl] = this._current || null;
                });
                newCache[title] = p;
            });
            profitPieStateCache = newCache;
        } catch (e) {
        }

        // ============================================================
        // 5. PIE LEGEND
        // ============================================================
        const legend2 = topHalf.selectAll("g.pie-legend").data([null]).join("g").attr("class", "pie-legend");
        const legendItems = [
            { label: "Profit", color: pieColors.Profit },
            { label: "Rework", color: pieColors.Rework },
            { label: "Labor", color: pieColors.Labor },
            { label: "Material", color: pieColors.Material }
        ];

        const rowGapLegend = 18 * uiScale;
        const legendHeight = 2 * rowGapLegend;
        const legendBaseY = pieSectionHeight - pad - legendHeight - uiScale;

        const measurer2 = svg.append("text").style("opacity", 0).attr("font-size", sizes.body);
        function itemWidth(lbl) {
            measurer2.text(lbl);
            return 12 * uiScale + 6 * uiScale + measurer2.node().getBBox().width;
        }
        const col1Width = Math.max(itemWidth(legendItems[0].label), itemWidth(legendItems[2].label));
        const col2Width = Math.max(itemWidth(legendItems[1].label), itemWidth(legendItems[3].label));
        const colGap = 28 * uiScale;
        const totalLegendWidth2 = col1Width + colGap + col2Width;
        const startX = Math.max(0, pad + (innerW - totalLegendWidth2) / 2);

        const legend2Data = [
            { ...legendItems[0], col: 0, row: 0 },
            { ...legendItems[1], col: 1, row: 0 },
            { ...legendItems[2], col: 0, row: 1 },
            { ...legendItems[3], col: 1, row: 1 },
        ];
        const legendRows = legend2.selectAll("g.legend-row").data(legend2Data, d => d.label);
        const legendRowsEnter = legendRows.enter().append("g").attr("class", "legend-row");
        const legendRowsMerge = legendRowsEnter.merge(legendRows);
        legendRowsMerge.attr("transform", d => {
            const xCol = d.col === 0 ? startX : startX + col1Width + colGap;
            const yRow = legendBaseY + d.row * rowGapLegend;
            return `translate(${xCol}, ${yRow})`;
        });
        legendRowsEnter.append("rect").attr("width", 12 * uiScale).attr("height", 12 * uiScale).attr("y", 3 * uiScale).attr("rx", 2).attr("fill", d => d.color);
        legendRowsEnter.append("text").attr("x", 18 * uiScale).attr("y", 13 * uiScale).attr("font-size", sizes.body).text(d => d.label);
        legendRows.exit().remove();
        measurer2.remove();

        // ---------- PART B: BAR CHARTS ----------
        const bottomHalf = breakdownGroup.selectAll("g.bottom-half").data([null]).join("g").attr("class", "bottom-half").attr("transform", `translate(0, ${pieSectionHeight})`);

        bottomHalf.selectAll("rect.breakdown-border").data([null]).join("rect")
            .attr("class", "breakdown-border")
            .attr("x", pad / 2).attr("y", pad / 2)
            .attr("width", Math.max(0, breakdownWidth - pad))
            .attr("height", barSectionHeight - pad);

        const barM = { top: 25 * uiScale, right: 10 * uiScale, bottom: 40 * uiScale, left: 10 * uiScale };
        bottomHalf.selectAll("text.breakdown-title").data([null]).join("text")
            .attr("x", pad / 2 + (breakdownWidth - pad) / 2)
            .attr("y", pad / 2 + 20 * uiScale)
            .attr("text-anchor", "middle")
            .attr("font-size", sizes.subtitle)
            .attr("font-weight", "bold")
            .text("Profit by Model");

        const barShiftX = 24;
        const barH = barSectionHeight - pad - barM.top - (1.5 * barM.bottom);

        const minP = d3.min(perModel, d => d.profit);
        const maxP = d3.max(perModel, d => d.profit);
        const yBar = d3.scaleLinear()
            .domain([Math.min(0, minP), Math.max(0, maxP)])
            .nice()
            .range([barH, 0])
            .clamp(true);

        let maxLabelWidth = 0;
        const tempText = svg.append("text").style("opacity", 0).attr("font-size", sizes.axis);
        yBar.ticks(5).forEach(t => {
            maxLabelWidth = Math.max(maxLabelWidth, tempText.text(d3.format("~s")(t)).node().getBBox().width);
        });
        tempText.remove();

        const yAxisSpace = maxLabelWidth + 15 * uiScale;
        const barW = Math.max(10, breakdownWidth - 2 * pad - barM.right - yAxisSpace - barShiftX);

        const gB = bottomHalf.selectAll("g.bars-group").data([null]).join("g").attr("class", "bars-group").attr("transform", `translate(${pad + barShiftX},${pad + barM.top})`);
        const xBand = d3.scaleBand()
            .domain(perModel.map(d => d.label))
            .range([yAxisSpace, yAxisSpace + barW])
            .padding(0.25);

        const gBY = gB.selectAll("g.y-axis").data([null]).join("g").attr("class", "y-axis").attr("transform", `translate(${yAxisSpace},0)`);
        if (t) gBY.transition(t).call(d3.axisLeft(yBar).ticks(5).tickFormat(d3.format("~s")));
        else gBY.call(d3.axisLeft(yBar).ticks(5).tickFormat(d3.format("~s")));
        gBY.selectAll("text").attr("font-size", sizes.axis);

        const gBX = gB.selectAll("g.x-axis").data([null]).join("g").attr("class", "x-axis").attr("transform", `translate(0,${barH})`);
        if (t) gBX.transition(t).call(d3.axisBottom(xBand));
        else gBX.call(d3.axisBottom(xBand));
        gBX.selectAll("text").attr("font-size", sizes.axis);

        const zeroY = yBar(0);
        const baseline = gB.selectAll("line.profit-bar-baseline").data([null]).join("line").attr("class", "profit-bar-baseline");
        baseline.attr("x1", yAxisSpace).attr("x2", yAxisSpace + barW);

        const currentBaselinePos = baseline.attr("y1") ? +baseline.attr("y1") : zeroY;
        const oldBaselineY = (previousBaselineY === 0) ? currentBaselinePos : previousBaselineY;

        if (previousBaselineY === 0) {
            baseline.attr("y1", zeroY).attr("y2", zeroY);
        }

        previousBaselineY = zeroY;

        const clipId = `profit-bars-clip`;
        const svgDefs = defs;
        const clipPathSel = svgDefs.selectAll(`clipPath#${clipId}`).data([null]).join("clipPath").attr("id", clipId);
        clipPathSel.selectAll("rect").data([null]).join("rect")
            .attr("x", yAxisSpace)
            .attr("y", 0)
            .attr("width", barW)
            .attr("height", barH);

        const modelColor = {
            Super: getComputedStyle(root).getPropertyValue('--super-color').trim(),
            Ultra: getComputedStyle(root).getPropertyValue('--ultra-color').trim(),
            Mega: getComputedStyle(root).getPropertyValue('--mega-color').trim()
        };
        const ttBar = createTooltip('profit-bar-tooltip');

        const barsG = gB.selectAll("g.bars-clip").data([null]).join("g").attr("class", "bars-clip").attr("clip-path", `url(#${clipId})`);
        const barSelection = barsG.selectAll("rect.profit-bar")
            .data(perModel, d => d.label);

        const barEnter = barSelection.enter().append("rect")
            .attr("class", "profit-bar")
            .attr("x", d => xBand(d.label))
            .attr("width", xBand.bandwidth())
            .attr("y", zeroY)
            .attr("height", 0)
            .attr("rx", 4)
            .attr("fill", d => modelColor[d.label] || getComputedStyle(root).getPropertyValue('--accent'))
            .on("mouseenter", () => ttBar.style("opacity", 1))
            .on("mouseleave", () => ttBar.style("opacity", 0))
            .on("mousemove", (ev, d) => {
                ttBar.html(
                    `<div class="tooltip-header">${d.label}</div>
                    <div class="tooltip-row"><span class="tooltip-key">Profit</span><span>${fmtMoney(d.profit)}</span></div>
                    <div class="tooltip-row"><span class="tooltip-key">Margin</span><span>${fmtPct(d.margin)}</span></div>`
                ).style("left", (ev.clientX + 14) + "px").style("top", (ev.clientY - 24) + "px");
            })
            .each(function () { this.__wasEntered = true; })
            .style("fill-opacity", 1)
            .style("display", null);

        barEnter.transition(t)
            .attr("y", d => {
                const yVal = yBar(d.profit);
                const safeY = Number.isFinite(yVal) ? yVal : zeroY;
                return Math.min(safeY, zeroY);
            })
            .attr("height", d => {
                const yVal = yBar(d.profit);
                const safeY = Number.isFinite(yVal) ? yVal : zeroY;
                return Math.abs(safeY - zeroY);
            })
            .on("end", function () { this._currentProfit = d3.select(this).datum().profit; });

        const barUpdate = barSelection.merge(barEnter);

        let anySignChange = false;
        barSelection.each(function (d) {
            const node = this;
            const prevProfit = (typeof node._currentProfit !== 'undefined') ? node._currentProfit : 0;
            if ((prevProfit >= 0) !== (d.profit >= 0)) {
                anySignChange = true;
            }
        });

        const sharedTransition = d3.transition()
            .duration(anySignChange ? Math.round(baseDuration / 2) : baseDuration)
            .ease(d3.easeLinear);

        baseline.interrupt();
        if (anySignChange && baseDuration > 0) {
            baseline.transition(sharedTransition).attr("y1", zeroY).attr("y2", zeroY);
        } else if (baseDuration > 0) {
            baseline.transition(sharedTransition).attr("y1", zeroY).attr("y2", zeroY);
        } else {
            baseline.attr("y1", zeroY).attr("y2", zeroY);
        }

        barUpdate
            .attr("x", d => xBand(d.label))
            .attr("width", xBand.bandwidth())
            .attr("fill", d => modelColor[d.label] || getComputedStyle(root).getPropertyValue('--accent'))
            .style("fill-opacity", 1)
            .style("display", null)
            .each(function (d, i, nodes) {
                const node = this;
                if (node.__wasEntered) {
                    delete node.__wasEntered;
                    node._currentProfit = d.profit;
                    return;
                }
                d3.select(node).interrupt();
                const prevProfit = (typeof node._currentProfit !== 'undefined') ? node._currentProfit : 0;
                const prevSign = (prevProfit >= 0);
                const newSign = (d.profit >= 0);
                const yVal = yBar(d.profit);
                const safeY = Number.isFinite(yVal) ? yVal : zeroY;
                const targetY = Math.min(safeY, zeroY);
                const targetH = Math.abs(safeY - zeroY);

                if (prevSign === newSign) {
                    const currentH = +d3.select(node).attr("height");
                    d3.select(node).transition(sharedTransition)
                        .attrTween("y", function () {
                            const baselineInterpolator = d3.interpolate(oldBaselineY, zeroY);
                            return function (t) {
                                const currentBaselineY = baselineInterpolator(t);
                                if (d.profit >= 0) {
                                    return currentBaselineY - currentH;
                                } else {
                                    return currentBaselineY;
                                }
                            };
                        })
                        .attr("height", currentH);

                    const transDuration = anySignChange ? Math.round(baseDuration / 2) : baseDuration;
                    d3.select(node).transition().delay(transDuration).duration(baseDuration).ease(d3.easeCubicOut)
                        .attr("height", targetH)
                        .attr("y", targetY)
                        .on("end", () => { node._currentProfit = d.profit; });
                } else {
                    const halfDur = Math.round(baseDuration / 2);
                    const currentH = +d3.select(node).attr("height");
                    const shrinkTransition = d3.select(node).transition(sharedTransition)
                        .attrTween("y", function () {
                            const baselineInterpolator = d3.interpolate(oldBaselineY, zeroY);
                            const heightInterpolator = d3.interpolate(currentH, 0);
                            return function (t) {
                                const currentBaselineY = baselineInterpolator(t);
                                const h = heightInterpolator(t);
                                if (prevSign) {
                                    return currentBaselineY - h;
                                } else {
                                    return currentBaselineY;
                                }
                            };
                        })
                        .attrTween("height", function () {
                            return d3.interpolate(currentH, 0);
                        });

                    const transDuration = anySignChange ? halfDur : baseDuration;
                    const expandTransition = d3.select(node).transition().delay(transDuration).duration(halfDur).ease(d3.easeCubicOut)
                        .attr("y", targetY)
                        .attr("height", targetH)
                        .on("end", function () {
                            this._currentProfit = d.profit;
                        });

                    if (d.profit < 0) {
                        expandTransition.on("start", function (d) {
                            d3.select(this).style("opacity", 0.3);
                        });
                    }
                }
            });

        barSelection.exit().remove();

        const overlaySelection = barsG.selectAll("rect.profit-bar-overlay")
            .data(perModel, d => d.label);

        const overlayEnter = overlaySelection.enter().append("rect")
            .attr("class", "profit-bar-overlay")
            .attr("x", d => xBand(d.label))
            .attr("width", xBand.bandwidth())
            .attr("y", zeroY)
            .attr("height", 0)
            .attr("rx", 4)
            .attr("fill", getComputedStyle(root).getPropertyValue('--failure-color').trim())
            .style("opacity", d => d.profit < 0 ? 0.3 : 0)
            .style("pointer-events", "none");

        overlayEnter.transition(t)
            .attr("y", d => {
                const yVal = yBar(d.profit);
                const safeY = Number.isFinite(yVal) ? yVal : zeroY;
                return Math.min(safeY, zeroY);
            })
            .attr("height", d => {
                const yVal = yBar(d.profit);
                const safeY = Number.isFinite(yVal) ? yVal : zeroY;
                return Math.abs(safeY - zeroY);
            })
            .on("end", function (d) { this._currentProfit = d.profit; d3.select(this).style("opacity", d.profit < 0 ? 0.3 : 0); });

        const overlayUpdate = overlaySelection.merge(overlayEnter);

        overlayUpdate
            .attr("x", d => xBand(d.label))
            .attr("width", xBand.bandwidth())
            .each(function (d) {
                const node = this;
                if (node.__wasEntered) {
                    delete node.__wasEntered;
                    node._currentProfit = d.profit;
                    return;
                }
                d3.select(node).interrupt();
                const prevProfit = (typeof node._currentProfit !== 'undefined') ? node._currentProfit : 0;
                const prevSign = (prevProfit >= 0);
                const newSign = (d.profit >= 0);
                const yVal = yBar(d.profit);
                const safeY = Number.isFinite(yVal) ? yVal : zeroY;
                const targetY = Math.min(safeY, zeroY);
                const targetH = Math.abs(safeY - zeroY);

                if (prevSign === newSign) {
                    const currentH = +d3.select(node).attr("height");
                    d3.select(node).transition(sharedTransition)
                        .attrTween("y", function () {
                            const baselineInterpolator = d3.interpolate(oldBaselineY, zeroY);
                            return function (t) {
                                const currentBaselineY = baselineInterpolator(t);
                                if (d.profit >= 0) {
                                    return currentBaselineY - currentH;
                                } else {
                                    return currentBaselineY;
                                }
                            };
                        })
                        .attr("height", currentH);

                    const transDuration = anySignChange ? Math.round(baseDuration / 2) : baseDuration;
                    d3.select(node).transition().delay(transDuration).duration(baseDuration).ease(d3.easeCubicOut)
                        .attr("height", targetH)
                        .attr("y", targetY)
                        .on("start", function (d) {
                            d3.select(this).style("opacity", d.profit < 0 ? 0.3 : 0);
                        })
                        .on("end", () => { node._currentProfit = d.profit; });
                } else {
                    const halfDur = Math.round(baseDuration / 2);
                    const currentH = +d3.select(node).attr("height");
                    const shrinkTransition = d3.select(node).transition(sharedTransition)
                        .attrTween("y", function () {
                            const baselineInterpolator = d3.interpolate(oldBaselineY, zeroY);
                            const heightInterpolator = d3.interpolate(currentH, 0);
                            return function (t) {
                                const currentBaselineY = baselineInterpolator(t);
                                const h = heightInterpolator(t);
                                if (prevSign) {
                                    return currentBaselineY - h;
                                } else {
                                    return currentBaselineY;
                                }
                            };
                        })
                        .attrTween("height", function () {
                            return d3.interpolate(currentH, 0);
                        });

                    if (d.profit >= 0) {
                        shrinkTransition.on("end", function () {
                            d3.select(this).style("opacity", 0);
                        });
                    }

                    const transDuration = anySignChange ? halfDur : baseDuration;
                    const expandTransition = d3.select(node).transition().delay(transDuration).duration(halfDur).ease(d3.easeCubicOut)
                        .attr("y", targetY)
                        .attr("height", targetH)
                        .on("end", function () {
                            this._currentProfit = d.profit;
                        });

                    if (d.profit < 0) {
                        expandTransition.on("start", function (d) {
                            d3.select(this).style("opacity", 0.3);
                        });
                    }
                }
            });

        overlaySelection.exit().remove();

        gB.selectAll("text.y-label").data([null]).join("text")
            .attr("class", "y-label")
            .attr("transform", "rotate(-90)")
            .attr("x", -barH / 2)
            .attr("y", yAxisSpace - 36 * uiScale)
            .attr("text-anchor", "middle")
            .attr("font-size", sizes.axis)
            .attr("font-weight", "bold")
            .text("Gross Profit");

        gB.selectAll("text.x-label").data([null]).join("text")
            .attr("class", "x-label")
            .attr("x", yAxisSpace + barW / 2)
            .attr("y", barH + barM.bottom + uiScale)
            .attr("text-anchor", "middle")
            .attr("font-size", sizes.axis)
            .attr("font-weight", "bold")
            .text("Model");

        svg.selectAll("text").each(function () {
            const t = d3.select(this);
            if (!t.attr("font-size")) {
                t.attr("font-size", sizes.body);
            }
        });
    }

    function resize() {
        const svg = d3.select("#profit-panel");
        svg.attr("width", 0).attr("height", 0);

        requestAnimationFrame(() => {
            draw(true);
        });
    }

    return { draw, resize };
})();