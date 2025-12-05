/**
 * --------------------------------------------------------------------
 * Precedence Chart Tab (IIFE)
 * --------------------------------------------------------------------
 */
const PrecedenceTab = (function () {

    // --- MODULE-LEVEL STATE ---
    let precedenceChartNodes = null;
    let pertTooltip = null;
    let simulation = null;
    let svg = null;
    let link = null;
    let svgWidth = 0;
    let svgHeight = 0;
    let drag = null;

    // Data for layouts
    let nodes = [];
    let links = [];
    let isKwLayoutActive = false;
    let kwTargetPositions = new Map();

    // --- LEGEND BOUNDARIES ---
    const LEGEND_AREAS = {
        topRight: { width: 220 + 30, height: 125 + 20 },
        bottomLeft: { width: 150 + 30, height: 140 + 20 }
    };

    // --- SANITIZER ---
    function sanitizeTooltipText(str) {
        if (!str && str !== 0) return "";
        let cleaned = String(str).trim();
        cleaned = cleaned.replace(/^["']+|["']+$/g, "");
        cleaned = cleaned.replace(/["']{2,}/g, "");
        return cleaned;
    }

    // --- HELPER FUNCTIONS ---

    function flatten() {
        const directPredecessors = new Map();
        if (systemState && systemState.elements) {
            systemState.elements.forEach(el => {
                directPredecessors.set(el.id, new Set(el.predecessors));
            });
        }

        const fullPredecessorMap = new Map();
        const memo = new Map();

        function getAllPredecessors(taskId) {
            if (memo.has(taskId)) return memo.get(taskId);
            const preds = directPredecessors.get(taskId) || new Set();
            const allPreds = new Set(preds);
            preds.forEach(pId => {
                const grandPreds = getAllPredecessors(pId);
                grandPreds.forEach(gpId => allPreds.add(gpId));
            });
            memo.set(taskId, allPreds);
            return allPreds;
        }

        if (systemState && systemState.elements) {
            systemState.elements.forEach(el => {
                fullPredecessorMap.set(el.id, getAllPredecessors(el.id));
            });
        }
        return fullPredecessorMap;
    }

    function getShortenedLinkEndpoint(sourcePos, targetPos, targetNode) {
        if (!sourcePos || !targetPos) return { x: 0, y: 0 };

        const targetRadius = (targetNode.r || 12) + 3;
        const dx = targetPos.x - sourcePos.x;
        const dy = targetPos.y - sourcePos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        let x2 = targetPos.x, y2 = targetPos.y;
        if (distance > 0) {
            const ratio = (distance - targetRadius) / distance;
            x2 = sourcePos.x + dx * ratio;
            y2 = sourcePos.y + dy * ratio;
        }
        return { x: x2, y: y2 };
    }

    function precomputeKwPositions() {
        if (!nodes.length || !links.length || !svgWidth || !svgHeight) return;

        kwTargetPositions.clear();
        const predecessors = new Map(nodes.map(n => [n.id, links.filter(l => l.target.id === n.id).map(l => l.source)]));
        const memo = new Map();
        function getDepth(node) {
            if (memo.has(node.id)) return memo.get(node.id);
            const preds = predecessors.get(node.id);
            if (!preds || preds.length === 0) { memo.set(node.id, 0); return 0; }
            const depth = 1 + Math.max(...preds.map(p => getDepth(p)));
            memo.set(node.id, depth);
            return depth;
        }
        nodes.forEach(n => getDepth(n));
        const nodesByDepth = new Map();
        let maxDepth = 0;
        nodes.forEach(node => {
            const depth = memo.get(node.id) || 0;
            if (!nodesByDepth.has(depth)) nodesByDepth.set(depth, []);
            nodesByDepth.get(depth).push(node);
            if (depth > maxDepth) maxDepth = depth;
        });

        const xPadding = svgWidth * 0.05;
        const yPadding = svgHeight * 0.05;

        const colWidth = (svgWidth - 2 * xPadding) / Math.max(1, maxDepth);

        nodesByDepth.forEach((colNodes, depth) => {
            let x = xPadding + depth * colWidth;
            const rowHeight = (svgHeight - 2 * yPadding) / Math.max(1, colNodes.length);

            colNodes.forEach((node, i) => {
                let y = yPadding + (i * rowHeight) + (rowHeight / 2);
                const r = node.r || 25;

                // Legend Avoidance
                const trBoundaryX = svgWidth - LEGEND_AREAS.topRight.width;
                const trBoundaryY = LEGEND_AREAS.topRight.height;
                if ((x + r) > trBoundaryX && (y - r) < trBoundaryY) {
                    y = Math.max(y, trBoundaryY + r + 10);
                }

                const blBoundaryX = LEGEND_AREAS.bottomLeft.width;
                const blBoundaryY = svgHeight - LEGEND_AREAS.bottomLeft.height;
                if ((x - r) < blBoundaryX && (y + r) > blBoundaryY) {
                    y = Math.min(y, blBoundaryY - r - 10);
                }

                kwTargetPositions.set(node.id, { x, y });
            });
        });
    }

    function applyKwLayout() {
        simulation.stop();
        precedenceChartNodes.on('.drag', null);

        nodes.forEach(node => {
            node.force_x = node.x;
            node.force_y = node.y;
        });

        const t = svg.transition().duration(750).ease(d3.easeCubicOut);

        precedenceChartNodes.transition(t)
            .attrTween("transform", function (d) {
                const endPos = kwTargetPositions.get(d.id);
                if (!endPos) return () => `translate(${d.x}, ${d.y})`;
                d.x = endPos.x;
                d.y = endPos.y;
                const interpolateX = d3.interpolate(d.force_x, endPos.x);
                const interpolateY = d3.interpolate(d.force_y, endPos.y);
                return function (time) {
                    return `translate(${interpolateX(time)}, ${interpolateY(time)})`;
                };
            });

        link.transition(t)
            .attrTween("x1", d => d3.interpolate(d.source.force_x, kwTargetPositions.get(d.source.id).x))
            .attrTween("y1", d => d3.interpolate(d.source.force_y, kwTargetPositions.get(d.source.id).y))
            .attrTween("x2", function (d) {
                const i_sx = d3.interpolate(d.source.force_x, kwTargetPositions.get(d.source.id).x);
                const i_sy = d3.interpolate(d.source.force_y, kwTargetPositions.get(d.source.id).y);
                const i_tx = d3.interpolate(d.target.force_x, kwTargetPositions.get(d.target.id).x);
                const i_ty = d3.interpolate(d.target.force_y, kwTargetPositions.get(d.target.id).y);
                return time => getShortenedLinkEndpoint({ x: i_sx(time), y: i_sy(time) }, { x: i_tx(time), y: i_ty(time) }, d.target).x;
            })
            .attrTween("y2", function (d) {
                const i_sx = d3.interpolate(d.source.force_x, kwTargetPositions.get(d.source.id).x);
                const i_sy = d3.interpolate(d.source.force_y, kwTargetPositions.get(d.source.id).y);
                const i_tx = d3.interpolate(d.target.force_x, kwTargetPositions.get(d.target.id).x);
                const i_ty = d3.interpolate(d.target.force_y, kwTargetPositions.get(d.target.id).y);
                return time => getShortenedLinkEndpoint({ x: i_sx(time), y: i_sy(time) }, { x: i_tx(time), y: i_ty(time) }, d.target).y;
            });
    }

    function removeKwLayout() {
        const t = svg.transition().duration(750).ease(d3.easeCubicOut);
        precedenceChartNodes.transition(t)
            .attr("transform", d => `translate(${d.force_x}, ${d.force_y})`);

        link.transition(t)
            .attrTween("x1", d => d3.interpolate(d.source.x, d.source.force_x))
            .attrTween("y1", d => d3.interpolate(d.source.y, d.source.force_y))
            .attrTween("x2", function (d) {
                const i_sx = d3.interpolate(d.source.x, d.source.force_x);
                const i_sy = d3.interpolate(d.source.y, d.source.force_y);
                const i_tx = d3.interpolate(d.target.x, d.target.force_x);
                const i_ty = d3.interpolate(d.target.y, d.target.force_y);
                return time => getShortenedLinkEndpoint({ x: i_sx(time), y: i_sy(time) }, { x: i_tx(time), y: i_ty(time) }, d.target).x;
            })
            .attrTween("y2", function (d) {
                const i_sx = d3.interpolate(d.source.x, d.source.force_x);
                const i_sy = d3.interpolate(d.source.y, d.source.force_y);
                const i_tx = d3.interpolate(d.target.x, d.target.force_x);
                const i_ty = d3.interpolate(d.target.y, d.target.force_y);
                return time => getShortenedLinkEndpoint({ x: i_sx(time), y: i_sy(time) }, { x: i_tx(time), y: i_ty(time) }, d.target).y;
            })
            .on("end", (d, i, elements) => {
                if (i === elements.length - 1) {
                    nodes.forEach(node => {
                        node.x = node.force_x;
                        node.y = node.force_y;
                        node.fx = null;
                        node.fy = null;
                    });
                    precedenceChartNodes.call(drag);
                    simulation.alpha(0.5).restart();
                }
            });
    }

    function updatePrecedenceChartColors(invalidNodes) {
        if (!precedenceChartNodes) return;
        invalidNodes = invalidNodes && invalidNodes.size ? invalidNodes : (invalidPrecedenceNodes || new Set());

        const elementOrderMap = new Map();
        let orderIndex = 0;
        document.querySelectorAll('.element-row').forEach(row => {
            const taskId = parseInt(row.dataset.taskId);
            elementOrderMap.set(taskId, orderIndex++);
        });

        const failureColor = getComputedStyle(document.documentElement).getPropertyValue('--failure-color').trim();
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        const white = getComputedStyle(document.documentElement).getPropertyValue('--white').trim();

        const allLinks = d3.selectAll('.precedence-link');
        allLinks.interrupt("blink");
        const violatingLinkKeys = new Set();
        allLinks.each(function (l) {
            if (!l || !l.source || !l.target) return;
            const srcOrder = elementOrderMap.get(l.source.id);
            const tgtOrder = elementOrderMap.get(l.target.id);
            if (srcOrder != null && tgtOrder != null && srcOrder > tgtOrder) {
                violatingLinkKeys.add(`${l.source.id}-${l.target.id}`);
            }
        });
        const receivingNodeIds = new Set();
        violatingLinkKeys.forEach(k => {
            const parts = k.split('-').map(s => parseInt(s));
            receivingNodeIds.add(parts[1]);
        });

        function blinkLink(selection) {
            function loop() {
                selection.transition("blink").duration(600)
                    .attr('stroke', failureColor).attr('stroke-width', 6).attr('marker-end', 'url(#arrowhead-highlight)')
                    .transition("blink").duration(600)
                    .attr('stroke', failureColor).attr('stroke-width', 3).attr('marker-end', 'url(#arrowhead-highlight)')
                    .on('end', loop);
            }
            loop();
        }

        allLinks.each(function (l) {
            const sel = d3.select(this);
            const key = (l && l.source && l.target) ? `${l.source.id}-${l.target.id}` : null;
            if (key && violatingLinkKeys.has(key)) {
                blinkLink(sel);
            } else if (l && (invalidNodes.has(l.source.id) || invalidNodes.has(l.target.id))) {
                sel.transition().duration(300)
                    .attr('stroke', failureColor).attr('stroke-width', 3.5).attr('marker-end', 'url(#arrowhead-highlight)');
            } else {
                sel.transition().duration(300)
                    .attr('stroke', accent).attr('stroke-width', 2.5).attr('marker-end', 'url(#arrowhead)');
            }
        });

        precedenceChartNodes.selectAll('circle.pert-node-hitbox').interrupt("blink");
        precedenceChartNodes.selectAll('circle.pert-node-hitbox').each(function (d) {
            const circle = d3.select(this);
            const id = +d.id;
            if (receivingNodeIds.has(id)) {
                circle.transition().duration(200).attr("stroke", failureColor).attr("stroke-width", 8);
                function blinkCircle() {
                    circle.transition("blink").duration(600).ease(d3.easeCubicOut)
                        .attr("stroke-width", 26).attr("opacity", 1)
                        .transition("blink").duration(600).ease(d3.easeCubicOut)
                        .attr("stroke-width", 10).attr("opacity", 0.1)
                        .on("end", blinkCircle);
                }
                blinkCircle();
            } else if (invalidNodes.has(id)) {
                circle.transition().duration(300).attr("stroke", failureColor).attr("stroke-width", 6).style("fill", failureColor);
            } else {
                circle.transition().duration(500).attr("stroke", accent).attr("stroke-width", 1.5).style("fill", white);
            }
        });
    }

    function updatePrecedenceChartLinks(invalidNodes) {
        if (!precedenceChartNodes) return;
        invalidNodes = invalidNodes || new Set();
        const allLinks = d3.select("#precedence-panel").selectAll('g > line');
        if (invalidNodes.size === 0) {
            allLinks.transition().duration(300)
                .attr('stroke', getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
                .attr('stroke-width', 2.5).attr('marker-end', 'url(#arrowhead)');
            return;
        }
        const elementOrderMap = new Map();
        let orderIndex = 0;
        document.querySelectorAll('.element-row').forEach(row => {
            elementOrderMap.set(parseInt(row.dataset.taskId), orderIndex++);
        });
        const violatingPathNodes = new Set();
        for (const violatingNodeId of invalidNodes) {
            const allPredecessors = flatten().get(violatingNodeId) || new Set();
            for (const predecessorId of allPredecessors) {
                if (elementOrderMap.get(predecessorId) > elementOrderMap.get(violatingNodeId)) {
                    violatingPathNodes.add(violatingNodeId);
                    violatingPathNodes.add(predecessorId);
                }
            }
        }
        allLinks.each(function (d) {
            const isHighlighted = violatingPathNodes.has(d.source.id) && violatingPathNodes.has(d.target.id);
            d3.select(this).transition().duration(300)
                .attr('stroke', isHighlighted ? getComputedStyle(document.documentElement).getPropertyValue('--failure-color').trim() : getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
                .attr('stroke-width', isHighlighted ? 5.5 : 2.5)
                .attr('marker-end', isHighlighted ? 'url(#arrowhead-highlight)' : 'url(#arrowhead)');
        });
    }

    function getPertLaborTime(id) {
        // Safe access to state.taskData which is now hydrated by systemState.elements
        const t = state?.taskData?.get?.(id)?.laborTime;
        return Number.isFinite(t) ? t : 0;
    }

    function drawPERTNodePiesOnce() {
        if (!precedenceChartNodes || precedenceChartNodes.empty()) return;
        const times = nodes.map(d => getPertLaborTime(+d.id));
        if (!times.length) return;

        const scaleFactor = Math.max(0.6, Math.min(1.4, svgWidth / 1200));
        const rScale = d3.scaleLinear()
            .domain(d3.extent(times))
            .range([15, 56 * scaleFactor])
            .nice();

        const arc = d3.arc().innerRadius(0);
        const pie = d3.pie().sort(null).value(d => d.value);

        precedenceChartNodes.each(function (d) {
            const g = d3.select(this);
            const id = +d.id;

            const r = rScale(getPertLaborTime(id));
            d.r = r;

            g.select("circle.pert-node-hitbox").remove();
            g.append("circle")
                .attr("r", r)
                .attr("class", "pert-node-hitbox");

            const row = state.taskData.get(id);
            if (!row) return;
            const { elementTime: ET, Super: sup, Mega: meg, Ultra: ult } = row;
            const slices = [
                { key: "super", value: ET * sup, color: PERT_PIE_COLORS.super },
                { key: "mega", value: ET * meg, color: PERT_PIE_COLORS.mega },
                { key: "ultra", value: ET * ult, color: PERT_PIE_COLORS.ultra },
                { key: "idle", value: Math.max(0, ET * (1 - (sup + meg + ult))), color: PERT_PIE_COLORS.idle }
            ].filter(s => s.value > 1e-6);
            const arcGen = arc.outerRadius(r);

            g.selectAll("path.__pert_pie")
                .data(pie(slices)).join("path")
                .attr("class", "__pert_pie")
                .attr("d", arcGen)
                .style("fill", a => a.data.color);

            g.selectAll("text.precedence-node-text")
                .data([d]).join("text")
                .attr("class", "precedence-node-text")
                .text(d => d.id)
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central");

            g.on("mouseenter", event => {
                const task = state.taskData.get(id);
                const rawDesc = task ? task.description : "No description available.";
                const taskDescription = sanitizeTooltipText(rawDesc);
                pertTooltip.style("opacity", 1)
                    .style('max-width', '250px')
                    .html(
                        `<div class="tooltip-header">Element ${id}</div>
                        <div class="tooltip-row description" style="display: block; text-align: center; margin-bottom: 4px;">${taskDescription}</div>
                        <div class="tooltip-row"><span>Labor Time:</span> <b>${getPertLaborTime(id).toFixed(2)}</b></div>`
                    );
            }).on("mousemove", event => {
                pertTooltip.style("left", event.clientX + 14 + "px").style("top", event.clientY + 14 + "px");
            }).on("mouseleave", () => {
                pertTooltip.style("opacity", 0).style('max-width', null);
            });
        });

        addPERTLabelBackgrounds();
        restylePERTNodeLabelsStrong();
    }

    function addPERTLabelBackgrounds() {
        if (!precedenceChartNodes) return;
        precedenceChartNodes.each(function (d) {
            if (!d || d.id == null || !d.r) return;
            const g = d3.select(this);
            let bg = g.select(".__pert_label_bg");
            if (bg.empty()) {
                bg = g.insert("circle", "text").attr("class", "__pert_label_bg");
            }
            bg.attr("r", Math.max(11, d.r * .48));
        });
    }

    function restylePERTNodeLabelsStrong() {
        if (!precedenceChartNodes) return;
        precedenceChartNodes.each(function (d) {
            if (!d || d.id == null || !d.r) return;
            const fs = Math.max(15, Math.min(26, d.r * .42));
            d3.select(this).select("text")
                .raise()
                .style("font-size", fs + "px");
        });
    }

    function renderPrecedenceLegend() {
        const legendPadding = 12;
        const swatch = { w: 10, h: 10 };
        const colGap = 14, rowGap = 10, labelOffsetX = 8;
        const topGap = 20, bottomGap = 2;
        const legendWidth = 150;
        const legendHeight = legendPadding * 2 + topGap + (swatch.h + rowGap) * 2 + bottomGap + 14;
        const legendX = 20, legendY = svgHeight - legendHeight - 10;

        const g = svg.append("g")
            .attr("id", "precedence-legend")
            .attr("transform", `translate(${legendX}, ${legendY})`);

        g.append("rect")
            .attr("width", legendWidth)
            .attr("height", legendHeight)
            .attr("rx", 5)
            .classed("legend-box", true);

        const centerX = legendWidth / 2;
        g.append("text")
            .text("Build Ratios")
            .attr("x", centerX)
            .attr("y", 18)
            .classed("legend-title", true);

        const itemsGrid = [
            [
                { label: "Super", color: PERT_PIE_COLORS.super },
                { label: "Ultra", color: PERT_PIE_COLORS.ultra }
            ],
            [
                { label: "Mega", color: PERT_PIE_COLORS.mega },
                { label: "Idle", color: PERT_PIE_COLORS.idle }
            ]
        ];

        itemsGrid.forEach((rowItems, rowIndex) => {
            rowItems.forEach((item, colIndex) => {
                const colWidth = (legendWidth - legendPadding * 2) / 2;
                const gx = legendPadding + colIndex * (colWidth + colGap);
                const gy = legendPadding + topGap + rowIndex * (swatch.h + rowGap);
                const row = g.append("g").attr("transform", `translate(${gx}, ${gy})`);

                row.append("rect")
                    .attr("width", swatch.w)
                    .attr("height", swatch.h)
                    .attr("fill", item.color)
                    .attr("stroke", getComputedStyle(document.documentElement).getPropertyValue("--white").trim())
                    .attr("stroke-width", 1);

                row.append("text")
                    .text(item.label)
                    .attr("x", swatch.w + labelOffsetX)
                    .attr("y", swatch.h - 2)
                    .classed("legend-item-text", true);
            });
        });

        g.append("text")
            .text("Node size = Labor time")
            .attr("x", centerX)
            .attr("y", legendHeight - legendPadding)
            .attr("text-anchor", "middle")
            .classed("legend-item-text", true);
    }

    function createDagLegend() {
        const legendWidth = 220;
        const legendHeight = 125;
        const legendX = svgWidth - legendWidth - 20;
        const legendY = 20;
        const g = svg.append('g').attr('transform', `translate(${legendX}, ${legendY})`);
        g.append('rect')
            .attr('width', legendWidth)
            .attr('height', legendHeight)
            .attr('rx', 5)
            .classed("legend-box", true);
        g.append('text').text('Task Flow')
            .attr('x', legendWidth / 2)
            .attr('y', 22)
            .classed("legend-title", true);
        const diagram = g.append('g');
        const nodeRadius = 15;
        const startX = 55;
        const endX = legendWidth - 55;
        const midY = 55;
        diagram.append('line')
            .attr('x1', startX + nodeRadius)
            .attr('y1', midY)
            .attr('x2', endX - nodeRadius)
            .attr('y2', midY)
            .attr('class', 'dag-legend-arrow');

        const drawHollowPieNode = (container, label) => {
            const pie = d3.pie().sort(null).value(d => d.value);
            const arc = d3.arc().innerRadius(0).outerRadius(nodeRadius);
            const slices = [
                { value: 25, color: PERT_PIE_COLORS.super }, { value: 25, color: PERT_PIE_COLORS.mega },
                { value: 25, color: PERT_PIE_COLORS.ultra }, { value: 25, color: PERT_PIE_COLORS.idle }
            ];
            container.selectAll('path.pie-slice')
                .data(pie(slices)).join('path')
                .attr('class', 'pie-slice __pert_pie')
                .attr('d', arc)
                .style('fill', d => d.data.color);

            const textNode = container.append('text')
                .text(label)
                .attr('class', 'dag-legend-node-text')
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central");

            container.insert('circle', 'text')
                .attr('class', '__pert_label_bg')
                .attr('r', nodeRadius * 0.48);

            textNode.raise();
        };
        const predecessorNode = diagram.append('g').attr('transform', `translate(${startX}, ${midY})`).style('cursor', 'pointer');
        drawHollowPieNode(predecessorNode, 'A');
        diagram.append('text').text('Predecessor').attr('x', startX).attr('y', midY + 28).classed("legend-item-text", true).attr('text-anchor', 'middle');
        const successorNode = diagram.append('g').attr('transform', `translate(${endX}, ${midY})`).style('cursor', 'pointer');
        drawHollowPieNode(successorNode, 'B');
        diagram.append('text').text('Successor').attr('x', endX).attr('y', midY + 28).classed("legend-item-text", true).attr('text-anchor', 'middle');

        const tooltipHandler = (event) => {
            const desc = sanitizeTooltipText("Predecessor task (A) must be completed before Successor task (B) can begin.");
            pertTooltip.style('opacity', 1)
                .style('max-width', '250px')
                .html(
                    `<div class="tooltip-header">Precedence</div>
                    <div class="tooltip-row description" style="text-align: center; display: block; margin-bottom: 4px;">${desc}</div>`
                );
        };
        const tooltipMove = (event) => pertTooltip.style('left', (event.clientX + 14) + 'px').style('top', (event.clientY + 14) + 'px');
        const tooltipHide = () => pertTooltip.style('opacity', 0);
        predecessorNode.on('mouseenter', tooltipHandler).on('mousemove', tooltipMove).on('mouseleave', tooltipHide);
        successorNode.on('mouseenter', tooltipHandler).on('mousemove', tooltipMove).on('mouseleave', tooltipHide);

        const switchUiGroup = g.append('g').style('cursor', 'pointer');
        switchUiGroup.append('text')
            .text('K&W Diagram')
            .attr('y', 15)
            .attr('class', 'dag-legend-switch-text');

        const switchGroup = switchUiGroup.append('g').attr('transform', 'translate(100, 0)');
        switchGroup.append('rect')
            .attr('width', 40)
            .attr('height', 20)
            .attr('rx', 10)
            .attr('fill', '#ccc');

        const switchHandle = switchGroup.append('circle')
            .attr('cx', 10)
            .attr('cy', 10)
            .attr('r', 8)
            .attr('class', 'dag-legend-switch-handle');

        const switchBBox = switchUiGroup.node().getBBox();
        switchUiGroup.attr('transform', `translate(${(legendWidth - switchBBox.width) / 2}, 95)`);

        switchUiGroup.on('mouseenter', (event) => {
            const kwDesc = "A Kilbridge and Wester Diagram arranges tasks by precedence depth (columns). It is essential for balancing mixed-model lines by identifying which tasks can be grouped into workstations without violating order constraints.";
            pertTooltip.style('opacity', 1)
                .style('max-width', '300px')
                .html(
                    `<div class="tooltip-header">Kilbridge & Wester Diagram</div>
                    <div class="tooltip-row description" style="display: block; line-height: 1.4;">${kwDesc}</div>`
                );
        })
            .on("mousemove", tooltipMove)
            .on("mouseleave", tooltipHide)
            .on('click', () => {
                tooltipHide();
                isKwLayoutActive = !isKwLayoutActive;
                if (isKwLayoutActive) {
                    switchGroup.select('rect').attr('fill', getComputedStyle(document.documentElement).getPropertyValue('--primary'));
                    switchHandle.transition().attr('cx', 30);
                    applyKwLayout();
                } else {
                    switchGroup.select('rect').attr('fill', '#ccc');
                    switchHandle.transition().attr('cx', 10);
                    removeKwLayout();
                }
            });
    }

    // --- PUBLIC FUNCTIONS ---

    function update(invalidNodes) {
        if (!precedenceChartNodes) return;
        invalidNodes = invalidNodes || new Set();
        updatePrecedenceChartColors(invalidNodes);
        updatePrecedenceChartLinks(invalidNodes);
    }

    function resize() {
        if (!svg || !simulation) return;

        svgWidth = svg.node().parentElement.clientWidth;
        svgHeight = svg.node().parentElement.clientHeight;

        svg.attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
        const zoomPane = svg.select(".zoom-pane");
        zoomPane.attr("width", svgWidth).attr("height", svgHeight);

        precomputeKwPositions();
        drawPERTNodePiesOnce();

        if (isKwLayoutActive) {
            simulation.stop();
            precedenceChartNodes.on('.drag', null);
            precedenceChartNodes.attr("transform", function (d) {
                const pos = kwTargetPositions.get(d.id);
                if (pos) {
                    d.x = pos.x; d.y = pos.y;
                    return `translate(${pos.x}, ${pos.y})`;
                }
                return d3.select(this).attr("transform");
            });
            link.each(function (d) {
                const sourcePos = kwTargetPositions.get(d.source.id);
                const targetPos = kwTargetPositions.get(d.target.id);
                if (sourcePos && targetPos) {
                    const end = getShortenedLinkEndpoint(sourcePos, targetPos, d.target);
                    d3.select(this)
                        .attr("x1", sourcePos.x).attr("y1", sourcePos.y)
                        .attr("x2", end.x).attr("y2", end.y);
                }
            });
        } else {
            simulation.force("center", d3.forceCenter(svgWidth / 2, svgHeight / 2).strength(0.1));
            simulation.force("collide", d3.forceCollide().radius(d => (d.r || 50) + 8).strength(1));
            simulation.alpha(0.3).restart();
        }

        const dagLegend = svg.selectAll('g').filter(function () {
            const txt = this.querySelector('text');
            return txt && txt.textContent.trim() === 'Task Flow';
        });
        if (!dagLegend.empty()) {
            const legendWidth = 220;
            const transform = dagLegend.attr('transform') || '';
            const m = /translate\(\s*([^,\s]+)\s*,\s*([^)]+)\s*\)/.exec(transform);
            const curY = m ? m[2] : 20;
            dagLegend.attr('transform', `translate(${svgWidth - legendWidth - 20}, ${curY})`);
        }
    }

    function draw(invalidNodes) {
        isKwLayoutActive = false;
        kwTargetPositions.clear();

        // FIX: SOURCE FROM DYNAMIC STATE
        nodes = (systemState.elements || []).map(d => ({ id: d.id }));
        links = [];
        (systemState.elements || []).forEach(d => {
            d.predecessors.forEach(pId => links.push({ source: pId, target: d.id }));
        });

        svg = d3.select("#precedence-panel");
        svg.selectAll("*").remove();

        svgWidth = document.getElementById('svg-container').clientWidth;
        svgHeight = document.getElementById('svg-container').clientHeight;

        svg.attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
        svg.append('defs').selectAll('marker')
            .data(['arrowhead', 'arrowhead-highlight'])
            .join('marker')
            .attr('id', d => d)
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 10)
            .attr('orient', 'auto')
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', d => d === 'arrowhead-highlight' ? getComputedStyle(document.documentElement).getPropertyValue('--failure-color').trim() : getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());

        const zoomPane = svg.append("rect")
            .attr("class", "zoom-pane")
            .attr("width", svgWidth).attr("height", svgHeight)
            .style("fill", "none")
            .style("pointer-events", "all");

        const mainGroup = svg.append("g");
        pertTooltip = createTooltip('pert-tooltip').style("position", "fixed");

        const forceAvoidLegends = (alpha) => {
            const LEGEND_REPULSION_STRENGTH = 0.3;
            nodes.forEach(d => {
                const r = (d.r || 50) + 15;
                const trLimitX = svgWidth - LEGEND_AREAS.topRight.width;
                const trLimitY = LEGEND_AREAS.topRight.height;
                if ((d.x + r) > trLimitX && (d.y - r) < trLimitY) {
                    const dx = (d.x + r) - trLimitX;
                    const dy = trLimitY - (d.y - r);
                    d.vx -= dx * LEGEND_REPULSION_STRENGTH * alpha ^ 3;
                    d.vy += dy * LEGEND_REPULSION_STRENGTH * alpha ^ 3;
                }
                const blLimitX = LEGEND_AREAS.bottomLeft.width;
                const blLimitY = svgHeight - LEGEND_AREAS.bottomLeft.height;
                if ((d.x - r) < blLimitX && (d.y + r) > blLimitY) {
                    const dx = blLimitX - (d.x - r);
                    const dy = (d.y + r) - blLimitY;
                    d.vx += dx * LEGEND_REPULSION_STRENGTH * alpha;
                    d.vy -= dy * LEGEND_REPULSION_STRENGTH * alpha;
                }
            });
        };

        simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(links).id(d => d.id).distance(40))
            .force("charge", d3.forceManyBody().strength(-500))
            .force("center", d3.forceCenter(svgWidth / 2, svgHeight / 2).strength(0.1))
            .force("collide", d3.forceCollide().radius(d => (d.r || 50) + 12).strength(1))
            .force("antiLegend", forceAvoidLegends);

        link = mainGroup.append("g").selectAll("line").data(links).join("line")
            .attr("class", "precedence-link");

        precedenceChartNodes = mainGroup.append("g").selectAll("g").data(nodes).join("g");

        function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }
        function dragged(event, d) {
            d.fx = event.x;
            d.fy = event.y;
        }
        function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            if (!isKwLayoutActive) {
                d.fx = d.x;
                d.fy = d.y;
            }
        }
        drag = d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);

        const CLAMP_PAD = 12;
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

        simulation.on("tick", () => {
            nodes.forEach(d => {
                const r = (d.r || 12);
                d.x = clamp(d.x, CLAMP_PAD + r, svgWidth - CLAMP_PAD - r);
                d.y = clamp(d.y, CLAMP_PAD + r, svgHeight - CLAMP_PAD - r);
                if (d.fx != null) d.fx = clamp(d.fx, CLAMP_PAD + r, svgWidth - CLAMP_PAD - r);
                if (d.fy != null) d.fy = clamp(d.fy, CLAMP_PAD + r, svgHeight - CLAMP_PAD - r);
            });
            link.each(function (d) {
                const end = getShortenedLinkEndpoint(d.source, d.target, d.target);
                d3.select(this)
                    .attr("x1", d.source.x).attr("y1", d.source.y)
                    .attr("x2", end.x).attr("y2", end.y);
            });
            precedenceChartNodes.attr("transform", d => `translate(${d.x}, ${d.y})`);
        });

        const zoom = d3.zoom().scaleExtent([0.1, 8]).on("zoom", (event) => {
            mainGroup.attr("transform", event.transform);
        });
        svg.call(zoom);
        zoomPane.call(zoom);
        const DEFAULT_ZOOM = 0.95;
        const tx = (svgWidth - svgWidth * DEFAULT_ZOOM) / 2;
        const ty = (svgHeight - svgHeight * DEFAULT_ZOOM) / 2;
        const initialTransform = d3.zoomIdentity.translate(tx, ty).scale(DEFAULT_ZOOM);
        svg.call(zoom.transform, initialTransform);

        precedenceChartNodes.call(drag);

        precomputeKwPositions();
        renderPrecedenceLegend();
        createDagLegend();
        drawPERTNodePiesOnce();
        updatePrecedenceChartColors(invalidNodes);
        updatePrecedenceChartLinks(invalidNodes);
    }

    return { draw, update, flatten, resize };
})();