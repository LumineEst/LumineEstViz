// Constants for the charts, that would be useful.
const CHART_WIDTH = 500;
const CHART_HEIGHT = 250;
const MARGIN = { left: 50, bottom: 20, top: 20, right: 20 };
const ANIMATION_DURATION = 350;

let dataResult;
let initial = true;

setup();

function setup() {
    // Attach event listener to dropdowns
    d3.select('#dataset').on('change', changeDataset);
    d3.select('#metric').on('change', changeMetric);

    // Load in the data and generate the visualizations
    changeMetric();
    changeDataset();
}

/**
 * Handle the changing of Dataset Selection
 */
function changeDataset() {
    // Load the file indicated by the select menu
    const dataFile = d3.select('#dataset').property('value');

    d3.csv(`data/${dataFile}.csv`)
        .then(dataOutput => {
            dataResult = dataOutput.map((d) => ({
                Year: parseInt(d.Year),
                Leading_Cause_of_Death: d.Leading_Cause_of_Death,
                Total_Deaths: parseFloat(d.Total_Deaths),
                Total_Population: parseFloat(d.Total_Population)
            }));

            // Update charts
            const metric = d3.select('#metric').property('value');
            updateStackedAreaChart(dataResult);
            updateScatterPlot(dataResult);
            // To prevent duplicate load during initialization of Histogram
            if (initial == false) {
                updateHistogramChart(dataResult, metric);
            } else {
                initial = false;
                changeMetric();
            }
        })
        .catch(error => console.log(error));
}

/**
 * Handle the changing of the Metric Selection
 */
function changeMetric() {
    const metric = d3.select('#metric').property('value');
    if (dataResult) {
        // Update charts that depend on the metric
        updateHistogramChart(dataResult, metric);
        updateLineChart(metric);
    }
}

/**
 * Update the histogram chart
 * @param data
 * @param metric
 */
function updateHistogramChart(data, metric) {
    const svg = d3.select("#Histogram-div").select("svg");
    if (!svg.empty()) svg.remove();

    // Create SVG element and a tooltip div
    const chartDiv = d3.select("#Histogram-div");
    const chartSvg = chartDiv.append("svg")
        .attr("width", CHART_WIDTH)
        .attr("height", CHART_HEIGHT + 40);
    const innerSvg = chartSvg.append("g")
        .attr("transform", `translate(${MARGIN.left}, ${MARGIN.top})`);
    const tooltipBox = d3.select("#tooltip-box");

    // Get selected values for conditional logic
    const dataset = d3.select('#dataset').property('value');
    const selectedMetric = d3.select('#metric').property('value');
    const causes = [...new Set(data.map(d => d.Leading_Cause_of_Death))].sort();

    // Create histogram generator for the selected metric
    const histogram = d3.histogram()
        .value(d => d[metric])
        .domain(d3.extent(data, d => d[metric]))
        .thresholds(8);
    const bins = histogram(data);

    // Prepare data for stacking by counting occurrences within each bin
    const dataForStack = bins.map(bin => {
        const counts = {};
        causes.forEach(cause => {
            counts[cause] = 0;
        });
        bin.forEach(d => {
            counts[d.Leading_Cause_of_Death]++;
        });
        counts.x0 = bin.x0;
        counts.x1 = bin.x1;
        // Calculate the median for each bin
        counts.median = (bin.x0 + bin.x1) / 2;
        return counts;
    });

    // Create stack generator
    const stack = d3.stack().keys(causes);
    const stackedData = stack(dataForStack);

    // Create scales, using scaleBand for a uniform bar width and padding
    const x = d3.scaleBand()
        .domain(bins.map(d => `${d.x0}-${d.x1}`))
        .range([0, CHART_WIDTH - MARGIN.left - MARGIN.right])
        .paddingInner(0.1)
        .paddingOuter(0.1);
    const y = d3.scaleLinear()
        .domain([0, d3.max(stackedData, layer => d3.max(layer, d => d[1]))])
        .nice()
        .range([CHART_HEIGHT - MARGIN.top - MARGIN.bottom, 0]);
    const color = d3.scaleOrdinal(d3.schemeCategory10)
        .domain(causes);

    // Draw stacked bars with transitions and tooltips
    const series = innerSvg.selectAll(".series")
        .data(stackedData)
        .enter().append("g")
        .attr("fill", d => color(d.key));
    series.selectAll("rect")
        .data(d => d)
        .enter().append("rect")
        .attr("x", d => x(`${d.data.x0}-${d.data.x1}`))
        .attr("y", y(0))
        .attr("height", 0)
        .attr("width", x.bandwidth())
        .on("mouseover", (event, d) => {
            tooltipBox.html(`<strong>${metric.replace(/_/g, " ")}:</strong> ${d3.format(".2s")(d.data.x0)}-${d3.format(".2s")(d.data.x1)} | <strong>Cause:</strong> ${d3.select(event.target.parentNode).datum().key} | <strong>Frequency:</strong> ${d[1] - d[0]}`);
        })
        .on("mouseout", () => {
            tooltipBox.html('Hover over a chart element to see its details.');
        })
        .transition()
        .duration(ANIMATION_DURATION)
        .attr("y", d => y(d[1]))
        .attr("height", d => y(d[0]) - y(d[1]));

    // Add x-axis and label each bin with its midpoint value
    const xAxis = d3.axisBottom(x);
    xAxis.tickFormat(d => {
        // Find the bin that corresponds to the tick's range string
        const bin = dataForStack.find(b => `${b.x0}-${b.x1}` === d);
        return bin ? d3.format(".2s")(bin.median) : "";
    });

    innerSvg.append("g")
        .attr("transform", `translate(0, ${CHART_HEIGHT - MARGIN.top - MARGIN.bottom})`)
        .call(xAxis)
        .selectAll("text")
        .style("text-anchor", "end")
        .attr("dx", "-.8em")
        .attr("dy", ".15em")
        .attr("transform", "rotate(-45)");
    chartSvg.append("text")
        .attr("transform", `translate(${CHART_WIDTH / 2}, ${CHART_HEIGHT - MARGIN.bottom + 50})`)
        .style("text-anchor", "middle")
        .style("font-weight", "bold")
        .text(metric.replace(/_/g, " "));

    // Add y-axis and label
    innerSvg.append("g")
        .call(d3.axisLeft(y));
    chartSvg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", MARGIN.left - 50)
        .attr("x", -(CHART_HEIGHT / 2))
        .attr("dy", "1em")
        .style("text-anchor", "middle")
        .style("font-weight", "bold")
        .text("Frequency");

    // Add legend and apply transitions
    const legend = chartSvg.append("g")
        .attr("font-family", "sans-serif")
        .attr("font-size", 10);
    const legendItems = legend.selectAll("g")
        .data(causes.slice().reverse())
        .join(
            enter => {
                const group = enter.append("g")
                    .attr("transform", (d, i) => `translate(0, ${i * 20})`)
                    .style("opacity", 0);
                group.append("rect")
                    .attr("width", 19)
                    .attr("height", 19)
                    .attr("fill", color);
                group.append("text")
                    .attr("y", 9.5)
                    .attr("dy", "0.32em")
                    .text(d => d);
                return group.transition().duration(ANIMATION_DURATION)
                    .style("opacity", 1);
            },
            update => update,
            exit => exit.transition().duration(ANIMATION_DURATION)
                .style("opacity", 0)
                .remove()
        );

    // Shift the legend whenever the chart overlaps with it
    const shouldTransition = (dataset === 'Germany' && selectedMetric === 'Total_Population');
    legendItems.select("rect")
        .transition().duration(shouldTransition ? ANIMATION_DURATION : 0)
        .attr("x", () => {
            return shouldTransition ? MARGIN.left + 20 : CHART_WIDTH - 39;
        });
    legendItems.select("text")
        .transition().duration(shouldTransition ? ANIMATION_DURATION : 0)
        .attr("x", () => {
            return shouldTransition ? MARGIN.left + 44 : CHART_WIDTH - 43;
        })
        .attr("text-anchor", () => {
            return shouldTransition ? "start" : "end";
        });
}

/**
 * Update the line chart
 * @param metric
 */
function updateLineChart(metric) {
    // Loading all four datasets to show on this chart.
    const dataFiles = ['China', 'Germany', 'United Kingdom', 'United States'];
    const tooltipBox = d3.select("#tooltip-box");
    d3.select("#Linechart-div").select("svg").remove();

    Promise.all(dataFiles.map(file => d3.csv(`data/${file}.csv`)))
        .then(dataOutputs => {
            // Create a dictionary to hold the parsed data
            const allData = {};
            dataOutputs.forEach((data, i) => {
                allData[dataFiles[i]] = data.map(d => ({
                    Year: parseInt(d.Year),
                    Leading_Cause_of_Death: d.Leading_Cause_of_Death,
                    Total_Deaths: parseFloat(d.Total_Deaths),
                    Total_Population: parseFloat(d.Total_Population),
                    Country: dataFiles[i]
                }));
            });

            // Get all parsed data into a single array to find min/max for scales
            const combinedData = Object.values(allData).flat();
            let chartSvg = d3.select("#Linechart-div").select("svg");
            if (chartSvg.empty()) {
                chartSvg = d3.select("#Linechart-div")
                    .append("svg")
                    .attr("width", CHART_WIDTH)
                    .attr("height", CHART_HEIGHT + 35);
            }

            let innerSvg = chartSvg.select("g");
            if (innerSvg.empty()) {
                innerSvg = chartSvg.append("g")
                    .attr("transform", `translate(${MARGIN.left}, ${MARGIN.top})`);
            }

            // Create scales
            const x = d3.scaleLinear()
                .domain(d3.extent(combinedData, d => d.Year))
                .range([0, CHART_WIDTH - MARGIN.left - MARGIN.right]);

            const y = d3.scaleLinear()
                .domain(d3.extent(combinedData, d => d[metric]))
                .nice()
                .range([CHART_HEIGHT - MARGIN.top - MARGIN.bottom, 0]);

            const color = d3.scaleOrdinal()
                .domain(dataFiles)
                .range(['#b10000', '#8A2BE2', '#CC5500', '#008B8B']);

            // Create a line generator
            const line = d3.line()
                .x(d => x(d.Year))
                .y(d => y(d[metric]));

            // Join new data to old elements
            let paths = innerSvg.selectAll(".line-path")
                .data(Object.entries(allData));

            // Animate exiting elements
            paths.exit().transition().duration(ANIMATION_DURATION).remove();
            paths.transition().duration(ANIMATION_DURATION)
                .attr("d", d => line(d[1]))
                .attr("stroke", d => color(d[0]));

            // Animate entering elements
            paths.enter().append("path")
                .attr("class", "line-path")
                .attr("fill", "none")
                .attr("stroke", d => color(d[0]))
                .attr("stroke-width", 3)
                .attr("d", d => line(d[1]))
                .on("mouseover", (event, d) => {
                    tooltipBox.html(`<strong>Dataset:</strong> ${d[0]} | <strong>Metric:</strong> ${metric.replace(/_/g, " ")}`);
                })
                .on("mouseout", () => {
                    tooltipBox.html('Hover over a chart element to see its details.');
                })
                .transition()
                .duration(ANIMATION_DURATION)
                .on("start", function () {
                    // Get the total length of the line
                    const totalLength = this.getTotalLength();
                    // Set up the dash array for the animation
                    d3.select(this).attr("stroke-dasharray", totalLength + " " + totalLength)
                        .attr("stroke-dashoffset", totalLength);
                })
                .attr("stroke-dashoffset", 0);

            // Animate axis transitions
            innerSvg.select(".x-axis").call(d3.axisBottom(x).tickFormat(d3.format("d")));
            innerSvg.select(".y-axis").transition().duration(ANIMATION_DURATION)
                .call(d3.axisLeft(y).tickFormat(d3.format(".2s")));

            // Add axes if they don't exist
            if (innerSvg.select(".x-axis").empty()) {
                innerSvg.append("g")
                    .attr("class", "x-axis")
                    .attr("transform", `translate(0, ${CHART_HEIGHT - MARGIN.top - MARGIN.bottom})`)
                    .call(d3.axisBottom(x).tickFormat(d3.format("d")));
                chartSvg.append("text")
                    .attr("transform", `translate(${CHART_WIDTH / 2}, ${CHART_HEIGHT - MARGIN.bottom + 40})`)
                    .style("text-anchor", "middle")
                    .style("font-weight", "bold")
                    .text("Year");
            }

            if (innerSvg.select(".y-axis").empty()) {
                innerSvg.append("g")
                    .attr("class", "y-axis")
                    .call(d3.axisLeft(y).tickFormat(d3.format(".2s")));
                chartSvg.append("text")
                    .attr("transform", "rotate(-90)")
                    .attr("y", MARGIN.left - 55)
                    .attr("x", -(CHART_HEIGHT / 2))
                    .attr("dy", "1em")
                    .style("text-anchor", "middle")
                    .style("font-weight", "bold")
                    .text(metric.replace(/_/g, " "));
            } else {
                chartSvg.select(".y-axis")
                    .transition().duration(ANIMATION_DURATION)
                    .text(metric);
            }

            // Update legend position
            let legend = chartSvg.select(".legend");
            if (legend.empty()) {
                legend = chartSvg.append("g")
                    .attr("class", "legend")
                    .attr("font-family", "sans-serif")
                    .attr("font-size", 10);
            }

            // Check if the metric has changed, and only apply the transition if it has.
            const previousMetric = legend.attr('data-metric');
            const shouldTransition = previousMetric && previousMetric !== metric;
            legend.attr('data-metric', metric);

            const legendItems = legend.selectAll("g")
                .data(dataFiles.slice().reverse())
                .join(
                    enter => {
                        const group = enter.append("g")
                            .attr("transform", (d, i) => `translate(0, ${i * 20})`);
                        group.append("rect")
                            .attr("width", 19)
                            .attr("height", 19)
                            .attr("fill", d => color(d));
                        group.append("text")
                            .attr("y", 9.5)
                            .attr("dy", "0.32em")
                            .text(d => d);
                        return group;
                    },
                    update => update,
                    exit => exit.remove()
                );

            legendItems.transition().duration(shouldTransition ? ANIMATION_DURATION : 0)
                .attr("transform", (d, i) => `translate(0, ${i * 20})`);

            legendItems.select("rect")
                .transition().duration(shouldTransition ? ANIMATION_DURATION : 0)
                .attr("x", d => metric === 'Total_Population' ? MARGIN.left + 50 : CHART_WIDTH - 39);

            legendItems.select("text")
                .transition().duration(shouldTransition ? ANIMATION_DURATION : 0)
                .attr("x", d => metric === 'Total_Population' ? MARGIN.left + 74 : CHART_WIDTH - 43)
                .attr("text-anchor", d => metric === 'Total_Population' ? "start" : "end");


            // Add a semi-transparent overlay rectangle to capture mouse events over the entire chart area
            let overlay = innerSvg.select(".overlay");
            if (overlay.empty()) {
                overlay = innerSvg.append("rect")
                    .attr("class", "overlay")
                    .attr("width", CHART_WIDTH - MARGIN.left - MARGIN.right)
                    .attr("height", CHART_HEIGHT - MARGIN.top - MARGIN.bottom)
                    .style("fill", "none")
                    .style("pointer-events", "all");
            }

            const bisectDate = d3.bisector(d => d.Year).left;
            overlay.on("mouseover", () => {
                tooltipBox.style("opacity", 1);
            })
                .on("mouseout", () => {
                    tooltipBox.html('Hover over a chart element to see its details.');
                })
                .on("mousemove", mousemove);

            // Adding Tooltip outputs based on mouse bisection and closest country selection
            function mousemove(event) {
                const mouseX = d3.pointer(event)[0];
                const x0 = x.invert(mouseX);
                const i = bisectDate(combinedData, x0, 1);
                const d0 = combinedData[i - 1];
                const d1 = combinedData[i];
                const d = x0 - d0.Year > d1.Year - x0 ? d1 : d0;

                // Find the data point that matches the year and has the smallest difference in the metric value
                const closestPoint = combinedData
                    .filter(point => point.Year === d.Year)
                    .reduce((prev, curr) => {
                        return Math.abs(curr[metric] - y.invert(d3.pointer(event)[1])) < Math.abs(prev[metric] - y.invert(d3.pointer(event)[1])) ? curr : prev;
                    });

                tooltipBox.html(`<strong>Country:</strong> ${closestPoint.Country} | <strong>Year:</strong> ${closestPoint.Year} | <strong>${metric.replace(/_/g, " ")}:</strong> ${d3.format(",.2s")(closestPoint[metric])}`);
            }
        })
        .catch(error => console.log(error));
}

/**
 * Update the Stacked Area Chart
 * @param data
 */
function updateStackedAreaChart(data) {
    const svg = d3.select("#StackedAreaChart-div").select("svg");
    if (!svg.empty()) svg.remove();

    // Create SVG element and a tooltip div
    const chartDiv = d3.select("#StackedAreaChart-div");
    const chartSvg = chartDiv.append("svg")
        .attr("width", CHART_WIDTH)
        .attr("height", CHART_HEIGHT + 35);
    const innerSvg = chartSvg.append("g")
        .attr("transform", `translate(${MARGIN.left}, ${MARGIN.top})`);
    const tooltipBox = d3.select("#tooltip-box");

    // Group data by year to prepare for stacking
    const keys = ["Total_Population", "Total_Deaths"];
    const groupedData = d3.group(data, d => d.Year);
    const stackData = Array.from(groupedData, ([year, values]) => {
        const obj = { Year: year };
        keys.forEach(key => {
            obj[key] = d3.sum(values, d => d[key]);
        });
        return obj;
    });

    // Calculate cumulative deaths
    let cumulativeDeaths = 0;
    stackData.forEach(d => {
        cumulativeDeaths += d.Total_Deaths;
        d.Cumulative_Deaths = cumulativeDeaths;
    });

    // Update the keys and sort order for stacking
    const newKeys = ["Total_Population", "Cumulative_Deaths"];

    // Create stack generator
    const stack = d3.stack()
        .keys(newKeys)
        .order(d3.stackOrderNone);
    const stackedData = stack(stackData);

    // Create scales
    const x = d3.scaleTime()
        .domain(d3.extent(stackData, d => d.Year))
        .range([0, CHART_WIDTH - MARGIN.left - MARGIN.right]);
    const y = d3.scaleLinear()
        .domain([0, d3.max(stackedData[stackedData.length - 1], d => d[1])])
        .nice()
        .range([CHART_HEIGHT - MARGIN.top - MARGIN.bottom, 0]);
    const color = d3.scaleOrdinal()
        .domain(newKeys.slice())
        .range(['#000050', '#6e0000']);

    // Create area generator
    const area = d3.area()
        .x(d => x(d.data.Year))
        .y0(d => y(d[0]))
        .y1(d => y(d[1]));

    // Draw stacked areas
    innerSvg.selectAll("path")
        .data(stackedData)
        .join("path")
        .attr("fill", d => color(d.key))
        .attr("d", d => {
            const newArea = d3.area()
                .x(d => x(d.data.Year))
                .y0(y(0))
                .y1(d => y(d.data.Total_Population));
            return newArea(d);
        })
        .style("opacity", 0.8)
        .transition()
        .duration(ANIMATION_DURATION)
        .attr("d", area);

    // Add x-axis and label
    innerSvg.append("g")
        .attr("transform", `translate(0, ${CHART_HEIGHT - MARGIN.top - MARGIN.bottom})`)
        .call(d3.axisBottom(x).tickFormat(d3.format("d")));
    chartSvg.append("text")
        .attr("transform", `translate(${(CHART_WIDTH / 2)}, ${CHART_HEIGHT - MARGIN.bottom + 40})`)
        .style("text-anchor", "middle")
        .style("font-weight", "bold")
        .text("Year");

    // Add y-axis and label
    innerSvg.append("g")
        .call(d3.axisLeft(y).tickFormat(d3.format(".2s")));
    chartSvg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", MARGIN.left - 54)
        .attr("x", -(CHART_HEIGHT / 2))
        .attr("dy", "1em")
        .style("text-anchor", "middle")
        .style("font-weight", "bold")
        .text("Total Population");

    // Add legend in the top-left corner
    const legend = chartSvg.append("g")
        .attr("class", "legend")
        .attr("font-family", "sans-serif")
        .attr("font-size", 10)
        .attr("transform", `translate(${MARGIN.left + 20}, ${MARGIN.top})`);
    legend.selectAll("g")
        .data(newKeys.slice().reverse())
        .join("g")
        .attr("transform", (d, i) => `translate(0, ${i * 20})`)
        .call(g => g.append("rect")
            .attr("width", 19)
            .attr("height", 19)
            .attr("fill", color))
        .call(g => g.append("text")
            .attr("x", 24)
            .attr("y", 9.5)
            .attr("dy", "0.32em")
            .text(d => d.replace(/_/g, " ")));

    // Add a semi-transparent overlay rectangle to capture mouse events over the entire chart area
    const overlay = innerSvg.append("rect")
        .attr("width", CHART_WIDTH - MARGIN.left - MARGIN.right)
        .attr("height", CHART_HEIGHT - MARGIN.top - MARGIN.bottom)
        .style("fill", "none")
        .style("pointer-events", "all");
    const bisectDate = d3.bisector(d => d.Year).left;

    // Add event listener to the overlay
    overlay.on("mouseover", () => tooltipBox.style("opacity", 1))
        .on("mouseout", () => tooltipBox.html('Hover over a chart element to see its details.'))
        .on("mousemove", mousemove);

    // Add tooltip output based on mouse position on bisection of year
    function mousemove(event) {
        const mouseX = d3.pointer(event)[0];
        const x0 = x.invert(mouseX);
        const i = bisectDate(stackData, x0, 1);
        const d0 = stackData[i - 1];
        const d1 = stackData[i];
        const d = x0 - d0.Year > d1.Year - x0 ? d1 : d0;
        const tooltipContent = keys.map(key => {
            return `<strong>${key.replace(/_/g, " ")}:</strong> ${d3.format(",.2s")(d[key])}`;
        }).join(" | ");
        tooltipBox.html(`<strong>Year:</strong> ${d.Year} | ${tooltipContent}`);
    }
}

/**
 * Update the Scatter Plot.
 * @param data
 */
function updateScatterPlot(data) {
    const svg = d3.select("#ScatterPlot-div").select("svg");
    if (!svg.empty()) svg.remove();

    // Create SVG element and a tooltip div
    const dataset = d3.select('#dataset').property('value');
    const chartDiv = d3.select("#ScatterPlot-div");
    const chartSvg = chartDiv.append("svg")
        .attr("width", CHART_WIDTH)
        .attr("height", CHART_HEIGHT + 35);
    const innerSvg = chartSvg.append("g")
        .attr("transform", `translate(${MARGIN.left}, ${MARGIN.top})`);
    const tooltipBox = d3.select("#tooltip-box");

    // Get unique causes of death
    const causes = [...new Set(data.map(d => d.Leading_Cause_of_Death))].sort();

    // Create scales for both axes and color
    const x = d3.scaleLinear()
        .domain(d3.extent(data, d => d.Total_Population))
        .nice()
        .range([0, CHART_WIDTH - MARGIN.left - MARGIN.right]);
    const y = d3.scaleLinear()
        .domain(d3.extent(data, d => d.Total_Deaths))
        .nice()
        .range([CHART_HEIGHT - MARGIN.top - MARGIN.bottom, 0]);
    const color = d3.scaleOrdinal(d3.schemeCategory10)
        .domain(causes);

    // Add circles for each data point with transitions and tooltips
    innerSvg.selectAll("circle")
        .data(data)
        .join(
            enter => enter.append("circle")
                .attr("cx", d => x(d.Total_Population))
                .attr("cy", d => y(d.Total_Deaths))
                .attr("r", 5)
                .attr("fill", d => color(d.Leading_Cause_of_Death))
                .style("opacity", 0)
                .call(enter => enter.transition()
                    .duration(ANIMATION_DURATION)
                    .style("opacity", 1)),
            update => update.transition()
                .duration(ANIMATION_DURATION)
                .attr("cx", d => x(d.Total_Population))
                .attr("cy", d => y(d.Total_Deaths))
                .attr("fill", d => color(d.Leading_Cause_of_Death)),
            exit => exit.transition()
                .duration(ANIMATION_DURATION)
                .style("opacity", 0)
                .remove()
        )
        .on("mouseover", (event, d) => {
            tooltipBox.html(`<strong>Year:</strong> ${d.Year} | <strong>Population:</strong> ${d3.format(".2s")(d.Total_Population)} | <strong>Deaths:</strong> ${d3.format(".2s")(d.Total_Deaths)}`);
        })
        .on("mouseout", () => {
            tooltipBox.html('Hover over a chart element to see its details.');
        });

    // Add x-axis and label
    innerSvg.append("g")
        .attr("transform", `translate(0, ${CHART_HEIGHT - MARGIN.top - MARGIN.bottom})`)
        .call(d3.axisBottom(x).tickFormat(d3.format(".2s")));
    chartSvg.append("text")
        .attr("transform", `translate(${CHART_WIDTH / 2}, ${CHART_HEIGHT - MARGIN.bottom + 40})`)
        .style("text-anchor", "middle")
        .style("font-weight", "bold")
        .text("Total Population");

    // Add y-axis and label
    innerSvg.append("g")
        .call(d3.axisLeft(y).tickFormat(d3.format(".2s")));
    chartSvg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", MARGIN.left - 50)
        .attr("x", -(CHART_HEIGHT / 2))
        .attr("dy", "1em")
        .style("text-anchor", "middle")
        .style("font-weight", "bold")
        .text("Total Deaths");

    // Add legend
    const legend = chartSvg.append("g")
        .attr("font-family", "sans-serif")
        .attr("font-size", 10)
        .attr("text-anchor", "end");
    legend.selectAll("g")
        .data(causes.slice().reverse())
        .join("g")
        .transition()
        .duration(ANIMATION_DURATION)
        .attr("transform", (d, i) => {
            // Shift legend down for United States dataset to avoid overlap
            const yOffset = (dataset === 'United States') ? (i * 20) + 140 : i * 20;
            return `translate(0, ${yOffset})`;
        });
    legend.selectAll("g")
        .append("rect")
        .attr("x", CHART_WIDTH - 39)
        .attr("width", 19)
        .attr("height", 19)
        .attr("fill", color);
    legend.selectAll("g")
        .append("text")
        .attr("x", CHART_WIDTH - 43)
        .attr("y", 9.5)
        .attr("dy", "0.32em")
        .text(d => d);
}