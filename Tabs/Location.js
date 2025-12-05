/**
 * @file LocationTab.js
 * Manages the "Location" tab, including the US map for optimal factory
 * location, cost calculations (shipping, holding), and inventory simulation.
 */

const LocationTab = (() => {

    // --- Constants ---
    const DEMAND_UNIT_LBS = 410; // Weight per demand unit in pounds
    const TRUCK_CAPACITY_UNITS = 60; // Capacity of a full truckload (FTL) in units
    let PPI = 170; // Producer Price Index (mutable, can be user-set)

    // --- Module State ---
    const cityData = new Map();
    let optimalFactoryLocation = null;
    let totalDemandCapacity = { p10: 0, p50: 0, p90: 0, workingDays: [] };
    let optimizationMode = 'New';
    let selectedCityName = null;
    let holdingChartMode = 'shipments';
    let isBottomRibbonOpen = false;

    let _localWageStress = 0.0;
    let _currentWageDisplay = 'N/A';
    let _lastMedianHourly = null;

    let selectedCityInDropdown = "";

    // --- Map & D3 State ---
    let mapInitialized = false;
    let projection = null;
    let path = null;
    let radiusScale = null;
    let continentalStatesFeatures = null;
    let lastCheckedLocation = null;

    // --- Simulation State ---
    let simulationWorker = null;
    let isSimulationRunning = false;
    let simulationResults = null;
    let simulationError = null;
    let simulationPromiseResolve = null;
    let simulationPromiseReject = null;
    let isValidationRun = false;

    // --- Filter and Brush state variables ---
    let showOverageHighlight = true;
    let showRemovedHighlight = true;
    let brushSelection = null;

    // --- New Constants for Responsive Layout ---
    const TOP_PANEL_AREA_HEIGHT_RATIO = 0.1;
    const SUMMARY_WIDTH_RATIO = 0.20;
    const HORIZONTAL_GAP_RATIO = 0.02;
    const MIN_CONTROLS_PIXEL_WIDTH = 600;

    /**
     * Manages SVG layout, calculating positions and dimensions for all components.
     */
    const layoutManager = {
        svgWidth: 0,
        svgHeight: 0,
        isRibbonOpen: false,

        // Dimensions
        ribbonHeaderHeight: 30,
        ribbonContentHeight: 250,
        topPanelMargin: 5,
        modalWidth: 750,
        modalHeight: 525,

        /**
         * Update the manager's state with new dimensions.
         */
        update(width, height, isRibbonOpen) {
            this.svgWidth = width || 0;
            this.svgHeight = height || 0;
            this.isRibbonOpen = isRibbonOpen;
        },

        /**
         * Get coordinates for the bottom ribbon.
         */
        getRibbonRect() {
            const height = this.isRibbonOpen
                ? this.ribbonHeaderHeight + this.ribbonContentHeight
                : this.ribbonHeaderHeight;
            const y = this.svgHeight - height;
            return { x: 0, y: y, width: this.svgWidth, height: height };
        },

        /**
         * Get coordinates for the main map/content area.
         */
        getMainAreaRect() {
            const ribbonRect = this.getRibbonRect();
            return {
                x: 0,
                y: 0,
                width: this.svgWidth,
                height: Math.max(0, this.svgHeight - ribbonRect.height)
            };
        },

        /**
         * Get coordinates for the top-left controls panel.
         */
        getControlsRect() {
            const mainArea = this.getMainAreaRect();
            const rightAnchor = this.svgWidth * 0.6;
            const leftMargin = this.svgWidth * HORIZONTAL_GAP_RATIO;
            const maxAllowedWidth = Math.max(Math.floor(rightAnchor - leftMargin - this.topPanelMargin), 120);
            let width = Math.min(MIN_CONTROLS_PIXEL_WIDTH, maxAllowedWidth);
            width = Math.max(120, width);
            const x = Math.max(leftMargin, Math.min(rightAnchor - width - this.topPanelMargin, Math.max(0, rightAnchor - width - this.topPanelMargin)));
            const height = mainArea.height * TOP_PANEL_AREA_HEIGHT_RATIO;

            return {
                x: x,
                y: this.topPanelMargin,
                width: width,
                height: Math.max(80, height)
            };
        },

        /**
         * Get coordinates for the top-right summary panel.
         */
        getSummaryRect() {
            const mainArea = this.getMainAreaRect();

            // Determine available space to the right of the controls panel and use that to size the summary.
            const controls = this.getControlsRect();
            const gap = this.svgWidth * HORIZONTAL_GAP_RATIO;

            // Start with a target width but cap it to the available space; keep sensible min width.
            const targetWidth = Math.max(120, Math.floor(this.svgWidth * SUMMARY_WIDTH_RATIO));
            const availableRight = Math.max(120, Math.floor(this.svgWidth - (controls.x + controls.width) - gap - this.topPanelMargin));
            const width = Math.min(targetWidth, Math.max(120, availableRight));

            // Prefer placing near the rightAnchor but ensure it doesn't overflow.
            const preferredX = this.svgWidth * 0.6;
            const x = Math.min(Math.max(preferredX, controls.x + controls.width + gap), Math.max(0, this.svgWidth - width - this.topPanelMargin));
            const height = this.svgHeight * 0.23;

            return {
                x: x,
                y: this.topPanelMargin,
                width: width - this.topPanelMargin,
                height: height
            };
        },

        /**
         * Get the bounding box for the map itself, excluding top panels.
         */
        getMapBounds() {
            const mainArea = this.getMainAreaRect();
            const controlRect = this.getControlsRect();;

            const mapY = controlRect.y + controlRect.height + this.topPanelMargin;
            const mapHeight = Math.max(1, mainArea.height - mapY);

            return {
                x: 0,
                y: mapY,
                width: mainArea.width,
                height: mapHeight
            };
        },

        /**
         * Get coordinates for the modal dialog (e.g., PPI chart).
         */
        getModalRect() {
            const modalWidth = this.svgWidth * 0.8;
            const modalHeight = this.svgHeight * 0.8;
            const x = (this.svgWidth - modalWidth) / 2;
            const y = (this.svgHeight - modalHeight) / 2;

            return {
                x: x,
                y: y,
                width: modalWidth,
                height: modalHeight
            };
        }
    };

    /**
     * Converts degrees to radians.
     */
    const toRadians = (deg) => deg * (Math.PI / 180);

    /**
     * Calculates the great-circle distance (in miles) between two [lon, lat] coordinates.
     */
    const greatCircleDistance = (coords1, coords2) => {
        if (!coords1 || !coords2) return 0;

        const [lon1, lat1] = coords1.map(toRadians);
        const [lon2, lat2] = coords2.map(toRadians);

        const R = 3959; // Earth's radius in miles
        const dLat = lat2 - lat1;
        const dLon = lon2 - lon1;

        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon / 2) ** 2;

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    /**
     * Estimates a circuitry (road travel) factor based on straight-line distance.
     */
    const getCircuitryFactor = (distance) => {
        return (distance >= 250) ? 1.2 : 1.35;
    };

    /**
     * Loads and parses the PPI.csv file.
     */
    async function loadCsvBaselineData() {
        try {
            const data = await d3.csv("Data/PPI.csv");
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            let monthlyData = [];

            data.forEach(row => {
                const year = parseInt(row.Year);
                if (isNaN(year)) return;

                months.forEach((month, index) => {
                    const value = parseFloat(row[month]);
                    monthlyData.push({
                        date: new Date(year, index, 1),
                        value: value
                    });
                });
            });

            return monthlyData.sort((a, b) => a.date - b.date);

        } catch (error) {
            console.error("Failed to load PPI.csv:", error);
            return [];
        }
    }

    /**
     * Calculates the cost of a single LTL shipment.
     */
    const calculateLTLCost = (distance, shipmentWeightTons) => {
        const q = shipmentWeightTons;
        const d = distance;
        if (q <= 0 || d <= 0) return 0;

        const numerator = (PPI * q * d) / 5.14;
        const denominator = (q ** (1 / 7) * d ** (15 / 29)) - 3.5;

        if (denominator <= 0) return Infinity;
        return numerator / denominator;
    };

    /**
     * Calculates the holding cost breakdown based on various inputs from other tabs.
     */
    function calculateHoldingCostBreakdown() {
        const marrEl = document.getElementById('inv-marr');
        const workingDaysEl = document.getElementById('inv-workingDays');
        const taxRateEl = document.getElementById('inv-taxRate');

        const marr = marrEl ? parseFloat(marrEl.value) || 12.0 : 12.0;
        const workingDays = workingDaysEl ? parseFloat(workingDaysEl.value) || 250 : 250;
        const taxRate = taxRateEl ? parseFloat(taxRateEl.value) || 25.0 : 25.0;

        const capital = marr;
        const service = 5.0 + (5.0 * (workingDays / 365.0)) + (10.0 * (taxRate / 100.0));

        const cities = Array.from(cityData.values());
        let storage = 7.0;
        let risk = 10.0;

        if (cities.length > 0 && optimalFactoryLocation) {
            const distances = cities.map(c => greatCircleDistance(optimalFactoryLocation, c.coordinates));
            const minDistance = Math.min(...distances);
            const storageScale = d3.scaleLinear().domain([50, 500]).range([10.0, 4.0]).clamp(true);
            storage = storageScale(minDistance);

            const avgFreq = d3.mean(cities, c => c.freq);
            if (avgFreq) {
                const riskScale = d3.scalePow().exponent(2).domain([7, 60]).range([5.0, 15.0]).clamp(true);
                risk = riskScale(avgFreq);
            }
        }

        const total = capital + service + storage + risk;
        return { capital, storage, service, risk, total };
    }

    /**
     * Refreshes the holding cost input field with the new estimated breakdown.
     */
    function refreshHoldingCost() {
        const breakdown = calculateHoldingCostBreakdown();
        const input = d3.select("#loc-holding-cost-input");
        if (input.empty()) return;

        const currentVal = parseFloat(input.property("value"));
        const estimatedVal = parseFloat(input.attr("data-estimated-total") || 0);

        if (Math.abs(currentVal - estimatedVal) < 0.1 || !input.attr("data-estimated-total")) {
            input.property("value", breakdown.total.toFixed(1));
        }

        input.attr("data-estimated-total", breakdown.total.toFixed(1));
        input.attr("data-breakdown-capital", breakdown.capital.toFixed(2));
        input.attr("data-breakdown-storage", breakdown.storage.toFixed(2));
        input.attr("data-breakdown-service", breakdown.service.toFixed(2));
        input.attr("data-breakdown-risk", breakdown.risk.toFixed(2));
    }

    // -------------------------------------------------------------------------
    // Bottom Ribbon (Simulation) UI Handlers
    // -------------------------------------------------------------------------

    /**
     * Toggles the visibility of the bottom simulation ribbon using a delayed redraw.
     */
    function toggleBottomRibbon() {
        isBottomRibbonOpen = !isBottomRibbonOpen;
        const contentDiv = d3.select(".bottom-ribbon-content");

        d3.select(".bottom-ribbon-header-arrow")
            .html(isBottomRibbonOpen ? '▼' : '▲');
        contentDiv.style("display", isBottomRibbonOpen ? "flex" : "none");

        updateDynamicMapElements();

        setTimeout(() => {
            if (isBottomRibbonOpen) {
                if (!simulationResults && !isSimulationRunning && !simulationError) {
                    runDailyInventorySimulation().catch(e => console.warn("Initial sim run failed:", e));
                } else {
                    drawHoldingCostChart(true);
                }
            } else if (!isBottomRibbonOpen) {
                drawHoldingCostChart(false);
            }
        }, 400);
    }

    /**
     * Updates the chart mode (Inventory vs. Shipments) and redraws the chart.
     */
    function updateHoldingChartMode() {
        d3.select("#sim-inv-btn").classed('active', holdingChartMode === 'inventory');
        d3.select("#sim-ship-btn").classed('active', holdingChartMode === 'shipments');

        d3.select(".bottom-ribbon-header-title").html(
            `Simulation: <strong>${holdingChartMode === 'inventory' ? 'Inventory' : 'Shipments'}</strong>`
        );

        if (isBottomRibbonOpen) {
            drawHoldingCostChart();
        }
    }

    /**
    * ASYNC HELPER: Calls the global WageManager to get wage/stress data.
    * Updates local state variables and triggers global recalculations.
    */
    async function updateLocalWageStress(currentLaborCost) {
        if (!optimalFactoryLocation) {
            _localWageStress = 0;
            _currentWageDisplay = 'N/A';
            const displayEl = document.getElementById('loc-wage-display');
            if (displayEl) displayEl.textContent = 'N/A';
            return;
        }

        const [lon, lat] = optimalFactoryLocation;

        // Fetch from API (WageManager handles caching and persistence)
        const { medianHourly, stress } = await window.WageManager.update(lat, lon, currentLaborCost);

        // Only update the UI if we have a valid number (new or persisted)
        if (Number.isFinite(medianHourly) && medianHourly > 0) {
            _lastMedianHourly = medianHourly;
            _localWageStress = stress;

            const newValue = `$${medianHourly.toFixed(2)}/hr`;
            _currentWageDisplay = newValue;

            const displayEl = document.getElementById('loc-wage-display');
            if (displayEl) displayEl.textContent = newValue;

            if (typeof InvestmentTab !== 'undefined' && typeof InvestmentTab.calculate === 'function') {
                InvestmentTab.calculate();
            }

        } else {
            // If WageManager returns 0, it means NO data exists, Only set N/A if we don't already have a value shown.
            if (_currentWageDisplay === 'N/A') {
                _localWageStress = 0;
                const displayEl = document.getElementById('loc-wage-display');
                if (displayEl) displayEl.textContent = 'N/A';
            }
        }
    }

    /**
     * Runs the facility location optimization algorithm.
     */
    const runOptimization = (options = {}) => {
        const cities = Array.from(cityData.values());
        const ppiInputEl = d3.select("#loc-ppi-input");
        const ppiInput = ppiInputEl.empty() ? null : ppiInputEl.property("value");
        PPI = ppiInput ? parseFloat(ppiInput) : 170;

        // --- Weiszfeld / P-Median Logic ---
        if (optimizationMode === 'New') {
            if (cities.length === 1) {
                optimalFactoryLocation = cities[0].coordinates;
            } else if (cities.length < 2) {
                optimalFactoryLocation = null;
            } else {
                cities.forEach(c => {
                    const shipmentDetails = getShipmentDetails(null, c, 1);
                    const costPerShipmentPerMile = shipmentDetails ? shipmentDetails.costPerShipment : 0;
                    const shipmentsPerYear = 365.2425 / c.freq;
                    c.monetaryWeight = costPerShipmentPerMile * shipmentsPerYear;
                });
                let sumLon = 0, sumLat = 0, totalMonetaryWeight = 0;
                cities.forEach(c => {
                    if (c.monetaryWeight && isFinite(c.monetaryWeight)) {
                        sumLon += c.coordinates[0] * c.monetaryWeight;
                        sumLat += c.coordinates[1] * c.monetaryWeight;
                        totalMonetaryWeight += c.monetaryWeight;
                    }
                });
                if (totalMonetaryWeight <= 0) {
                    console.warn("Using geometric center (no valid monetary weights).");
                    sumLon = d3.sum(cities, c => c.coordinates[0]);
                    sumLat = d3.sum(cities, c => c.coordinates[1]);
                    totalMonetaryWeight = cities.length;
                    if (totalMonetaryWeight === 0) {
                        optimalFactoryLocation = null;
                    }
                }
                if (optimalFactoryLocation !== null || totalMonetaryWeight > 0) {
                    let currentLocation = [sumLon / totalMonetaryWeight, sumLat / totalMonetaryWeight];
                    for (let i = 0; i < 100; i++) {
                        let numLon = 0, numLat = 0, den = 0;
                        cities.forEach(city => {
                            const d = Math.max(0.001, greatCircleDistance(currentLocation, city.coordinates));
                            if (city.monetaryWeight && isFinite(city.monetaryWeight)) {
                                numLon += (city.coordinates[0] * city.monetaryWeight) / d;
                                numLat += (city.coordinates[1] * city.monetaryWeight) / d;
                                den += city.monetaryWeight / d;
                            }
                        });
                        if (den <= 0) break;
                        const nextLocation = [numLon / den, numLat / den];
                        if (greatCircleDistance(currentLocation, nextLocation) < 0.1) {
                            currentLocation = nextLocation;
                            break;
                        }
                        currentLocation = nextLocation;
                    }
                    const newMedianLocation = [+currentLocation[0].toFixed(2), +currentLocation[1].toFixed(2)];
                    let minCost = calculateTotalCost(newMedianLocation, cities);
                    let bestLocation = newMedianLocation;
                    for (const potentialSite of cities) {
                        const currentCost = calculateTotalCost(potentialSite.coordinates, cities);
                        if (currentCost <= minCost) {
                            minCost = currentCost;
                            bestLocation = potentialSite.coordinates;
                        }
                    }
                    optimalFactoryLocation = bestLocation;
                }
            }
        } else {
            if (cities.length < 1) {
                optimalFactoryLocation = null;
            } else {
                let bestLocation = null, minCost = Infinity;
                for (const potentialSite of cities) {
                    const currentCost = calculateTotalCost(potentialSite.coordinates, cities);
                    if (currentCost < minCost) {
                        minCost = currentCost;
                        bestLocation = potentialSite.coordinates;
                    }
                }
                optimalFactoryLocation = bestLocation;
            }
        }

        // --- Update UI Immediately ---
        if (mapInitialized) {
            updateOptimalFactoryMarker();
            setTimeout(() => updateConnectionLines(), 750);
        }
        updateSummaryPanel();
        refreshHoldingCost();

        // --- BACKGROUND API: Trigger Wage Update (Non-Blocking) ---
        return new Promise((resolve) => {
            setTimeout(async () => {
                const currentLaborCost = parseFloat(document.getElementById('laborCost')?.value) || 25;

                if (optimalFactoryLocation) {
                    await updateLocalWageStress(currentLaborCost);
                }
                resolve();
            }, 100);
        });
    };

    /**
     * Runs the daily inventory simulation in the web worker.
     */
    function runDailyInventorySimulation(validationParams = null) {
        return new Promise((resolve, reject) => {
            simulationPromiseResolve = resolve;
            simulationPromiseReject = reject;
            isValidationRun = !!validationParams;

            if (!simulationWorker) {
                console.error("Simulation worker is not initialized.");
                simulationError = "Worker failed load.";
                if (isBottomRibbonOpen) drawHoldingCostChart();
                return reject(new Error("Worker failed load."));
            }

            const paramsToUse = validationParams || getCurrentSimulationParams();
            if (!paramsToUse) {
                console.error("Could not get simulation parameters.");
                return reject(new Error("Could not get simulation parameters."));
            }

            isSimulationRunning = true;
            if (!isValidationRun) {
                simulationError = null;
            }

            if (isBottomRibbonOpen) {
                drawHoldingCostChart();
            }

            simulationWorker.postMessage({ type: 'start', payload: paramsToUse });
        });
    }

    /**
     * Gathers all necessary parameters from the DOM to send to the simulation worker.
     */
    function getCurrentSimulationParams() {
        // Get working days schedule
        let workingDaysSchedule = [];
        const investmentWorkingDaysEl = document.getElementById('inv-workingDays');

        if (investmentWorkingDaysEl && investmentWorkingDaysEl.dataset.workingDaysList) {
            try {
                workingDaysSchedule = JSON.parse(investmentWorkingDaysEl.dataset.workingDaysList);
            } catch (e) {
                console.error("Could not parse working days list", e);
            }
        }

        // Fallback to default 5-day work week if list is invalid
        if (!Array.isArray(workingDaysSchedule) || workingDaysSchedule.length === 0) {
            console.warn("Using default working days schedule");
            const year = new Date().getFullYear();
            const date = new Date(year, 0, 1);
            while (date.getFullYear() === year) {
                const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
                if (dayOfWeek > 0 && dayOfWeek < 6) {
                    workingDaysSchedule.push(date.toISOString().split('T')[0]);
                }
                date.setDate(date.getDate() + 1);
            }
        }

        // Get other parameters
        const opHoursEl = document.getElementById('opHours');
        const numEmployeesEl = document.getElementById('numEmployees');
        const laborCostEl = document.getElementById('laborCost');
        const holdingCostInput = document.getElementById('loc-holding-cost-input');
        const mfgOverheadEl = document.getElementById('inv-mfgOverhead');
        const sgaExpensesEl = document.getElementById('inv-sgaExpenses');
        const scInput = document.getElementById('superCogs');
        const ucInput = document.getElementById('ultraCogs');
        const mcInput = document.getElementById('megaCogs');

        const dailyDemandEl = document.getElementById('dailyDemand');
        const targetDailyProduction = (dailyDemandEl ? parseInt(dailyDemandEl.value) : 180) || 180;

        // Provide defaults for all parameters
        const standardOpHours = opHoursEl ? parseFloat(opHoursEl.value) || 15.0 : 15.0;
        const numEmployees = numEmployeesEl ? parseInt(numEmployeesEl.value) || 8 : 8;
        const laborCost = laborCostEl ? parseFloat(laborCostEl.value) || 25.0 : 25.0;
        const holdingCostRate = (holdingCostInput ? parseFloat(holdingCostInput.value) || 25.0 : 25.0) / 100;
        const annualMfgOverhead = mfgOverheadEl ? parseFloat(mfgOverheadEl.value.replace(/,/g, '')) || 250000 : 250000;
        const annualSgaExpenses = sgaExpensesEl ? parseFloat(sgaExpensesEl.value.replace(/,/g, '')) || 350000 : 350000;
        const superCogsVal = scInput ? parseFloat(scInput.value) : 375;
        const ultraCogsVal = ucInput ? parseFloat(ucInput.value) : 590;
        const mcInputVal = mcInput ? parseFloat(mcInput.value) : 960;

        // Ensure global objects/functions exist, provide fallbacks
        const buildRatios = typeof BUILD_RATIOS !== 'undefined' ? BUILD_RATIOS : { super: 0.33, ultra: 0.33, mega: 0.34 };

        const capacityMetrics = typeof calculateMetrics === 'function'
            ? calculateMetrics({ dailyDemand: 9999, opHours: standardOpHours, numEmployees }, {}, true)
            : { throughputUnitsPerDay: standardOpHours * 10 }; // Simple fallback

        const maxStandardProduction = Math.floor(capacityMetrics?.throughputUnitsPerDay || 0);
        const cities = Array.from(cityData.values());

        return {
            cities,
            workingDaysSchedule,
            standardOpHours,
            numEmployees,
            laborCost,
            holdingCostRate,
            annualMfgOverhead,
            annualSgaExpenses,
            superCogsVal,
            ultraCogsVal,
            mcInputVal,
            buildRatios,
            targetDailyProduction,
            maxStandardProduction
        };
    }

    /**
     *  Generates and downloads a CSV file from the current simulation results.
     */
    function exportSimulationCSV() {
        if (!simulationResults || simulationResults.length === 0) {
            alert("No simulation data available. Please run the simulation first.");
            return;
        }

        // Get constant inputs for columns that don't change per day
        const numEmployees = document.getElementById('numEmployees')?.value || "8";
        const opHoursStd = document.getElementById('opHours')?.value || "15.0";

        // 1. Define Headers
        const headers = [
            "Date",
            "Day Type",
            "Op Hours",
            "Produced Units",
            "Total Shipped",
            "Inventory End",
            "Holding Cost ($)",
            "Exception Cost ($)"
        ];

        // 2. Map Data Rows
        const rows = simulationResults.map(d => {
            // Determine Day Type String
            let type = "Standard";
            if (d.isReductionDay) type = "Reduction";
            else if (d.isExceptionDay) type = "Overtime/Exception";
            else if (!d.isWorkingDay) type = "Weekend/Holiday";

            // Determine Production Hours
            let hours = Math.max(d.opHours, opHoursStd).toFixed(2);
            if (d.isReductionDay || !d.isWorkingDay) {
                hours = 0;
            }
            const safe = (val) => String(val).replace(/,/g, "");

            // Shipments might be an object or number depending on your worker structure,
            return [
                d.date,
                type,
                hours, // Simulation usually returns specific hours for exception days
                safe(d.production),
                safe(d.actualShipments),
                safe(d.inventoryEnd),
                d.holdingCost.toFixed(2),
                d.exceptionCost.toFixed(2)
            ].join(",");
        });

        // 3. Construct CSV String
        const csvContent = [headers.join(","), ...rows].join("\n");

        // 4. Trigger Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `FactoryFlow_Sim_Export_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /**
     * Draws the PPI trend line chart in the modal.
     */
    async function drawPPITrendChart() {
        const svg = d3.select("#ppi-chart-svg");
        svg.selectAll("*").remove();
        const modalWidth = layoutManager.modalWidth;
        const modalHeight = layoutManager.modalHeight - 70;
        if (modalWidth <= 0 || modalHeight <= 0) return;
        svg.attr("viewBox", `0 0 ${modalWidth} ${modalHeight}`);

        const margin = { top: 20, right: 40, bottom: 40, left: 50 };
        const width = modalWidth - margin.left - margin.right;
        const height = modalHeight - margin.top - margin.bottom;

        const g = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        const tooltip = createTooltip("ppi-tooltip");

        const errorText = g.append("text")
            .attr("class", "ppi-loading-text")
            .attr("x", width / 2)
            .attr("y", height / 2)
            .attr("text-anchor", "middle")
            .attr("fill", "var(--failure-color)")
            .style("display", "none")
            .text("Loading...");

        try {
            // --- Load Data ---
            errorText.text("Loading baseline data...").style("display", null);
            let combinedData = await loadCsvBaselineData();
            if (combinedData.length === 0) throw new Error("Failed to load PPI data.");

            combinedData.sort((a, b) => a.date - b.date);
            const finalPpiData = combinedData;
            if (finalPpiData.length === 0) throw new Error("No PPI data available.");
            errorText.style("display", "none");

            // --- Define Scales ---
            const maxDate = d3.max(finalPpiData, d => d.date);
            const domainMaxDate = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
            const x = d3.scaleTime()
                .domain([d3.min(finalPpiData, d => d.date), domainMaxDate])
                .range([0, width]);

            const validValues = finalPpiData.map(d => d.value).filter(v => !isNaN(v));
            const yMin = d3.min(validValues) ?? 0;
            const yMax = d3.max(validValues) ?? 1;
            const yDomainMin = yMin * 0.95;
            const yDomainMax = (yMax === yMin) ? yMax * 1.1 + 1 : yMax * 1.05;
            const y = d3.scaleLinear()
                .domain([yDomainMin, yDomainMax])
                .range([height, 0]);

            const bisectDate = d3.bisector(d => d.date).left;
            const formatDate = d3.timeFormat("%b %Y");

            // --- Draw Axes ---
            g.append("g").attr("class", "axis x-axis")
                .attr("transform", `translate(0,${height})`)
                .call(d3.axisBottom(x).ticks(d3.timeYear.every(3)).tickFormat(d3.timeFormat("%Y")))
                .append("text").attr("class", "axis-label")
                .attr("fill", "var(--accent)").attr("x", width / 2).attr("y", 35)
                .attr("text-anchor", "middle").text("Year");

            g.append("g").attr("class", "axis y-axis")
                .call(d3.axisLeft(y))
                .append("text").attr("class", "axis-label")
                .attr("fill", "var(--accent)").attr("transform", "rotate(-90)").attr("y", -40)
                .attr("x", -height / 2).attr("text-anchor", "middle").text("Producer Price Index");

            // --- Draw Line ---
            const line = d3.line()
                .x(d => x(d.date))
                .y(d => y(d.value))
                .defined(d => !isNaN(d.value) && d.value !== null);

            g.append("path")
                .datum(finalPpiData.filter(d => !isNaN(d.value) && d.value !== null))
                .attr("class", "ppi-line")
                .attr("d", line);

            // --- Tooltip Setup ---
            const focus = g.append("g")
                .attr("class", "ppi-focus");

            focus.append("circle")
                .attr("r", 5)
                .attr("class", "ppi-focus-circle");

            g.append("rect")
                .attr("class", "ppi-overlay")
                .attr("width", width)
                .attr("height", height)
                .on("mouseover", () => {
                    focus.style("display", null);
                    tooltip.style("opacity", 1);
                })
                .on("mouseout", () => {
                    focus.style("display", "none");
                    tooltip.style("opacity", 0);
                })
                .on("mousemove", mousemove);

            function mousemove(event) {
                tooltip.style("opacity", 1);
                const pointer = d3.pointer(event, g.node());
                if (!pointer || pointer.length < 1) return;

                const x0 = x.invert(pointer[0]);
                const i = bisectDate(finalPpiData, x0, 1);
                const d0 = finalPpiData[i - 1];
                const d1 = finalPpiData[i];

                if (!d0 || !d1) {
                    focus.style("display", "none");
                    tooltip.style("opacity", 0);
                    return;
                }

                const d = (x0 - d0.date > d1.date - x0) ? d1 : d0;

                if (!d || isNaN(d.value) || d.value === null) {
                    focus.style("display", "none");
                    tooltip.style("opacity", 0);
                    return;
                } else {
                    focus.style("display", null);
                }

                focus.attr("transform", `translate(${x(d.date)},${y(d.value)})`);
                tooltip.html(`<strong>${formatDate(d.date)}</strong><div class="tooltip-row"><span>Price Index:</span> <span>${d.value.toFixed(2)}</span></div>`);

                tooltip.style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            }

        } catch (error) {
            console.error("Failed to draw PPI chart:", error);
            errorText.text(`Error: ${error.message}`).style("display", null);
            tooltip.style("opacity", 0);
        }
    }

    /**
     * Draws the main simulation chart (Inventory or Shipments) in the bottom ribbon.
     * Features: Split-Scale Fisheye, Opposing Colors, Stable Tooltips, Exception Highlighting, Error Overlays.
     */
    function drawHoldingCostChart(animate = false) {
        const svg = d3.select("#holding-cost-chart-svg");
        svg.selectAll("*").remove();

        const metricsPlaceholder = d3.select("#metrics-placeholder-in-demand");
        metricsPlaceholder.html("");

        const tooltip = createTooltip("holding-cost-tooltip");

        const svgNode = svg.node();
        if (!svgNode) return;
        const svgContainer = svgNode.parentNode;
        if (!svgContainer) return;

        // --- Get dimensions ---
        let viewBoxWidth = 0;
        let viewBoxHeight = 0;
        try {
            const rect = svgContainer.getBoundingClientRect();
            viewBoxWidth = rect.width;
            viewBoxHeight = rect.height;
            svg.attr("width", viewBoxWidth).attr("height", viewBoxHeight).attr("viewBox", `0 0 ${viewBoxWidth} ${viewBoxHeight}`);
        } catch (e) { return; }

        // --- Loading State ---
        if (isSimulationRunning) {
            metricsPlaceholder.html(`<p class="loading sim-loading-text">Loading...</p>`);
            if (viewBoxWidth > 0 && viewBoxHeight > 0) {
                svg.append("text").attr("x", viewBoxWidth / 2).attr("y", viewBoxHeight / 2).attr("text-anchor", "middle").text("Loading Simulation...");
            }
            return;
        }

        // --- Conflict Detection ---
        const isConflictError = simulationError && simulationError.startsWith("Demand Conflict");
        const hasValidResults = simulationResults && Array.isArray(simulationResults) && simulationResults.length > 0;

        // --- Empty/Error State ---
        if (!hasValidResults) {
            const margin = { top: 20, right: 30, bottom: 30, left: 55 };
            const height = viewBoxHeight - margin.top - margin.bottom;
            const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

            if (simulationError && !isConflictError) {
                g.append("text").attr("x", (viewBoxWidth - margin.left - margin.right) / 2).attr("y", height / 2).attr("text-anchor", "middle").attr("fill", "var(--failure-color)").text("Simulation Error");
                metricsPlaceholder.html(`<div class="summary-row error-message"><span class="sim-error-text">Sim Failed</span></div>`);
            } else {
                g.append("text").attr("x", (viewBoxWidth - margin.left - margin.right) / 2).attr("y", height / 2).attr("text-anchor", "middle").attr("fill", "var(--accent)").text("No Data");
            }
            return;
        }

        // --- Setup Chart Area ---
        const margin = { top: 20, right: 30, bottom: 30, left: 55 };
        const width = viewBoxWidth - margin.left - margin.right;
        const height = viewBoxHeight - margin.top - margin.bottom;
        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        // --- Colors & Inputs ---
        const primaryColor = getComputedStyle(root).getPropertyValue('--primary').trim();
        const secondaryColor = getComputedStyle(root).getPropertyValue('--secondary1').trim();
        const tertiaryColor = getComputedStyle(root).getPropertyValue('--secondary2').trim();
        const accentColor = getComputedStyle(root).getPropertyValue('--accent').trim();
        const failureColor = "var(--failure-color)";

        const opHoursEl = document.getElementById('opHours');
        const standardOpHours = opHoursEl ? parseFloat(opHoursEl.value) || 15.0 : 15.0;
        const dailyDemandEl = document.getElementById('dailyDemand');
        const targetDailyProduction = (dailyDemandEl ? parseInt(dailyDemandEl.value) : 180) || 180;
        const numEmployeesEl = document.getElementById('numEmployees');
        const numEmployees = numEmployeesEl ? parseInt(numEmployeesEl.value) || 8 : 8;

        // *** COGS Inputs for Valuation Calculation ***
        const scInput = document.getElementById('superCogs');
        const ucInput = document.getElementById('ultraCogs');
        const mcInput = document.getElementById('megaCogs');
        const superCogsVal = scInput ? parseFloat(scInput.value) : 375;
        const ultraCogsVal = ucInput ? parseFloat(ucInput.value) : 590;
        const mcInputVal = mcInput ? parseFloat(mcInput.value) : 960;

        const formatK = d3.format(".2s");
        const formatInt = d3.format(",.0f");
        const formatCurrency = (val) => val.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

        // Data Prep
        const dailyData = simulationResults.map((d, i) => ({ ...d, dateObj: new Date(d.date + 'T00:00:00Z'), originalIndex: i }));
        const N = dailyData.length;

        // --- Base Y Scale ---
        let yMax = 0;
        if (holdingChartMode === 'inventory') {
            yMax = d3.max(dailyData, d => d.inventoryEnd) ?? 0;
        } else {
            yMax = d3.max(dailyData, d => d.actualShipments) ?? 0;
        }
        const y = d3.scaleLinear().domain([0, Math.max(10, yMax * 1.1)]).range([height, 0]).nice();

        // Draw Y Axis
        g.append("g").attr("class", "axis y-axis-left").call(d3.axisLeft(y).tickFormat(holdingChartMode === 'inventory' ? formatK : formatInt));
        g.append("text").attr("class", "axis-label").attr("transform", "rotate(-90)").attr("y", -margin.left + 12).attr("x", -height / 2)
            .attr("text-anchor", "middle").style("font-size", "14px").attr("fill", "currentColor")
            .text(holdingChartMode === 'inventory' ? "Inventory On Hand" : "Units Delivered");

        // --- Metric Panel ---
        updateSidePanelMetrics(dailyData);

        // --- LAYERS ---
        const highlightsLayer = g.append("g").attr("class", "highlights-layer");
        const chartBody = g.append("g").attr("class", "chart-body");
        const axisLayer = g.append("g").attr("class", "axis x-axis").attr("transform", `translate(0,${height})`);

        // --- PREP DATA ---
        const monthStarts = [];
        let currentMonth = -1;
        dailyData.forEach((d, i) => {
            if (d.dateObj.getMonth() !== currentMonth) {
                monthStarts.push({ index: i, label: d3.utcFormat("%b")(d.dateObj) });
                currentMonth = d.dateObj.getMonth();
            }
        });
        const monthBoundaries = [...monthStarts.map(m => m.index), N];

        const highlightData = dailyData.filter(d =>
            (showRemovedHighlight && d.isReductionDay) ||
            (showOverageHighlight &&
                (d.isExceptionDay || (d.isWorkingDay && !d.isReductionDay && d.production > 0.01 && Math.abs((d.production || 0) - targetDailyProduction) > 0.01))
            )
        );

        // --- INITIAL ELEMENTS ---
        const monthLabels = axisLayer.selectAll(".month-label").data(monthStarts).join("text")
            .attr("class", "month-label axis-label").attr("y", 15).attr("text-anchor", "middle").style("font-size", "12px").attr("fill", "currentColor").text(d => d.label);

        const highlightRects = highlightsLayer.selectAll(".highlight-bar").data(highlightData, d => d.originalIndex).join("rect")
            .attr("class", "highlight-bar").attr("y", 0).attr("height", height).attr("fill", failureColor).style("opacity", 0.3).style("pointer-events", "none");

        if (holdingChartMode === 'inventory') {
            chartBody.append("path").attr("class", "inventory-area").attr("fill", tertiaryColor).style("opacity", 0.6);
        } else {
            chartBody.selectAll(".shipment-bar").data(dailyData).join("rect").attr("class", "shipment-bar")
                .attr("y", d => y(d.actualShipments)).attr("height", d => height - y(d.actualShipments))
                .attr("fill", d => (d.actualShipmentDetails?.some(det => det.city === selectedCityName) ? secondaryColor : primaryColor));
        }

        // --- Focus Bar ---
        const focusBar = g.append("rect").attr("class", "focus-bar").style("display", "none").style("pointer-events", "none").style("stroke", "#fff").style("stroke-width", "1px");

        if (holdingChartMode === 'inventory') {
            focusBar.attr("fill", primaryColor).style("opacity", 1.0);
        } else {
            focusBar.attr("fill", tertiaryColor).style("opacity", 1.0);
        }

        // --- FISHEYE LOGIC ---
        g.append("rect").attr("class", "hover-overlay").attr("width", width).attr("height", height).attr("fill", "transparent")
            .on("mousemove", onMouseMove).on("mouseleave", onMouseLeave);

        updateGeometry(null);

        function updateGeometry(hoverIndex, mouseX) {
            const positions = new Float32Array(N + 1);

            if (hoverIndex === null) {
                for (let i = 0; i <= N; i++) positions[i] = (i / N) * width;
            } else {
                const distortionStrength = 6.0;
                const distortionRadius = 30;
                const weights = new Float32Array(N);
                for (let i = 0; i < N; i++) {
                    const dist = Math.abs(i - hoverIndex);
                    weights[i] = 1 + distortionStrength * Math.exp(-(dist * dist) / (2 * distortionRadius * distortionRadius));
                }
                let leftTotalWeight = 0;
                for (let i = 0; i < hoverIndex; i++) leftTotalWeight += weights[i];
                leftTotalWeight += weights[hoverIndex] * 0.5;
                let rightTotalWeight = weights[hoverIndex] * 0.5;
                for (let i = hoverIndex + 1; i < N; i++) rightTotalWeight += weights[i];
                const safeMouseX = Math.max(0.1, Math.min(width - 0.1, mouseX));
                const scaleLeft = safeMouseX / leftTotalWeight;
                const scaleRight = (width - safeMouseX) / rightTotalWeight;
                for (let i = 0; i <= N; i++) {
                    if (i === 0) { positions[i] = 0; continue; }
                    const w = weights[i - 1];
                    const idx = i - 1;
                    if (idx < hoverIndex) { positions[i] = positions[i - 1] + w * scaleLeft; }
                    else if (idx > hoverIndex) { positions[i] = positions[i - 1] + w * scaleRight; }
                    else { positions[i] = safeMouseX + (w * 0.5 * scaleRight); }
                }
                positions[N] = width;
            }

            if (holdingChartMode === 'inventory') {
                const fisheyeArea = d3.area().x((d, i) => (positions[i] + positions[i + 1]) / 2).y0(height).y1(d => y(d.inventoryEnd)).curve(d3.curveStepAfter);
                chartBody.select(".inventory-area").attr("d", fisheyeArea(dailyData));
            } else {
                chartBody.selectAll(".shipment-bar")
                    .attr("x", (d, i) => positions[i])
                    .attr("width", (d, i) => Math.max(0, positions[i + 1] - positions[i] - 0.5));
            }

            highlightRects
                .attr("x", d => positions[d.originalIndex])
                .attr("width", d => positions[d.originalIndex + 1] - positions[d.originalIndex]);

            let lastX = -100;
            monthLabels
                .attr("x", (d, i) => (positions[d.index] + positions[monthBoundaries[i + 1]]) / 2)
                .style("opacity", function () {
                    const x = parseFloat(d3.select(this).attr("x"));
                    if (x - lastX < 35 || x < 10 || x > width - 10) return 0;
                    lastX = x;
                    return 1;
                });

            return positions;
        }

        function onMouseMove(event) {
            const [mouseX] = d3.pointer(event);
            const linearIndex = Math.max(0, Math.min(N - 1, Math.round((mouseX / width) * (N - 1))));
            const positions = updateGeometry(linearIndex, mouseX);
            const d = dailyData[linearIndex];
            const magWidth = (width / N) * 6;
            const centerPos = (positions[linearIndex] + positions[linearIndex + 1]) / 2;

            if (holdingChartMode === 'inventory') {
                const barY = y(d.inventoryEnd);
                focusBar.style("display", null)
                    .attr("x", centerPos - magWidth / 2).attr("width", magWidth)
                    .attr("y", barY).attr("height", Math.max(0, height - barY));
            } else {
                const barY = y(d.actualShipments);
                focusBar.style("display", null)
                    .attr("x", centerPos - magWidth / 2).attr("width", magWidth)
                    .attr("y", barY).attr("height", Math.max(0, height - barY));
            }
            updateTooltip(d, event);
        }

        function onMouseLeave() {
            updateGeometry(null);
            focusBar.style("display", "none");
            tooltip.style("opacity", 0);
        }

        function updateTooltip(d, event) {
            tooltip.style("opacity", 1);
            let operationsHtml = "";
            const dailyProduction = d.production || 0;

            const isException = d.isExceptionDay;
            const isReduction = d.isReductionDay;
            const prodStyle = (isException || isReduction) ? `color:${failureColor}; font-weight:bold;` : '';
            const opHoursStyle = (isException) ? `color:${failureColor}; font-weight:bold;` : '';

            if (dailyProduction > 0.01 || (d.opHours > 0.01 && !d.isReductionDay)) {
                let opHoursForCalc = d.isExceptionDay ? d.opHours : standardOpHours;
                let conveyorSpeed = 'N/A';
                try {
                    if (typeof calculateMetrics === 'function' && opHoursForCalc > 0.01) {
                        const m = calculateMetrics({ dailyDemand: Math.round(dailyProduction), opHours: opHoursForCalc, numEmployees: numEmployees }, {}, true);
                        if (m) conveyorSpeed = `${m.conveyorSpeed.toFixed(2)} ft/min`;
                    }
                } catch (e) { }

                operationsHtml = `<hr style='margin: 4px 0; border-top-color: #555;'>` +
                    `<div class="tooltip-header">Operations</div>` +
                    `<div class="tooltip-row"><span style="${opHoursStyle}">Op. Hours:</span> <span style="${opHoursStyle}">${opHoursForCalc.toFixed(2)} h</span></div>` +
                    `<div class="tooltip-row"><span>Conv. Speed:</span> <span>${conveyorSpeed}</span></div>`;
            }

            let extra = "";
            if (holdingChartMode === 'shipments' && d.actualShipmentDetails?.length > 0) {
                extra += `<hr style='margin: 4px 0; border-top-color: #555;'><div class="tooltip-header">Shipments</div>`;
                d.actualShipmentDetails.forEach(det => {
                    const style = (det.city === selectedCityName) ? "font-weight:bold;color:var(--secondary1);" : "";
                    extra += `<div class="tooltip-row" style="${style}"><span>${det.city}:</span> <span>${formatInt(det.qty)}</span></div>`;
                });
            }

            const dateStr = d3.utcFormat("%b %d")(d.dateObj);
            tooltip.html(
                `<strong>${dateStr}</strong>` +
                `<div class="tooltip-row"><span>Inventory:</span> <span>${formatInt(d.inventoryEnd)}</span></div>` +
                `<div class="tooltip-row"><span style="${prodStyle}">Produced:</span> <span style="${prodStyle}">${formatInt(d.production)}</span></div>` +
                `<div class="tooltip-row"><span>Shipped:</span> <span>${formatInt(d.actualShipments)}</span></div>` +
                operationsHtml + extra
            );

            const ttNode = tooltip.node();
            const ttHeight = ttNode ? ttNode.getBoundingClientRect().height : 150;
            positionTooltip(tooltip, event, 15, -ttHeight - 20);
        }

        function updateSidePanelMetrics(data) {
            const avgInventory = d3.mean(data, d => d.inventoryEnd) || 0;
            const totalHolding = d3.sum(data, d => d.holdingCost);
            const totalException = d3.sum(data, d => d.exceptionCost);
            const ratios = typeof BUILD_RATIOS !== 'undefined' ? BUILD_RATIOS : { super: 0.33, ultra: 0.33, mega: 0.34 };
            const avgCogs = (superCogsVal * ratios.super) + (ultraCogsVal * ratios.ultra) + (mcInputVal * ratios.mega);
            const valuation = avgInventory * avgCogs;

            if (holdingChartMode === 'inventory') {
                metricsPlaceholder.html(
                    `<div class="summary-row"><span>Avg. Inventory:</span><span><strong>${formatInt(avgInventory)}</strong></span></div>` +
                    `<div class="summary-row"><span>Inv. Valuation:</span><span><strong>${formatCurrency(valuation)}</strong></span></div>` +
                    `<div class="summary-row total"><span>Holding Costs:</span><span><strong>${formatCurrency(totalHolding)}</strong></span></div>`
                );
            } else {
                const overage = d3.sum(data, d => d.isExceptionDay ? 1 : 0);
                const removed = d3.sum(data, d => d.isReductionDay ? 1 : 0);

                const row1 = metricsPlaceholder.append("div").attr("class", "summary-row filter-row");
                row1.append("label").text("Overages: ").append("input").attr("type", "checkbox").property("checked", showOverageHighlight).on("change", function () { showOverageHighlight = this.checked; drawHoldingCostChart(); });
                row1.append("strong").text(` ${overage} days`);

                const row2 = metricsPlaceholder.append("div").attr("class", "summary-row filter-row");
                row2.append("label").text("Removed: ").append("input").attr("type", "checkbox").property("checked", showRemovedHighlight).on("change", function () { showRemovedHighlight = this.checked; drawHoldingCostChart(); });
                row2.append("strong").text(` ${removed} days`);

                metricsPlaceholder.append("div").attr("class", "summary-row total").html(`<span>Exception Costs:</span><span style="color:${failureColor}">${formatCurrency(totalException)}</span>`);
            }
        }

        // --- Conflict Overlay ---
        if (isConflictError) {
            const rawConflictMessage = simulationError || "Unknown Conflict";

            // Faded background
            g.append("rect")
                .attr("class", "error-overlay-bg")
                .attr("x", 0).attr("y", 0).attr("width", width).attr("height", height)
                .attr("fill", "rgba(255, 255, 255, 0.85)")
                .style("pointer-events", "none");

            // Error message text
            const errorFo = g.append("foreignObject")
                .attr("x", 10).attr("y", 10).attr("width", width - 20).attr("height", height - 20)
                .style("pointer-events", "none");

            errorFo.append("xhtml:div")
                .attr("class", "chart-error-message")
                .html(rawConflictMessage.replace(/\n/g, "<br>"));
        }
    }

    /**
     * Helper function to draw a custom month axis.
     */
    function drawMonthAxis(selection, xScale, chartHeight) {
        const monthStarts = d3.utcMonth.range(xScale.domain()[0], d3.utcDay.offset(xScale.domain()[1], 1));

        // Draw the main axis line with ticks
        const xAxis = d3.axisBottom(xScale)
            .tickValues(monthStarts)
            .tickFormat("")
            .tickSizeOuter(0);

        const axisGroup = selection.append("g")
            .attr("class", "axis x-axis")
            .attr("transform", `translate(0,${chartHeight})`)
            .call(xAxis);

        // Add centered month labels (e.g., "Jan", "Feb")
        axisGroup.selectAll(".month-label")
            .data(monthStarts)
            .enter().append("text")
            .attr("class", "month-label axis-label")
            .attr("x", d => {
                const nextMonth = d3.utcMonth.offset(d, 1);
                const endPos = xScale(nextMonth < xScale.domain()[1] ? nextMonth : xScale.domain()[1]);
                const startPos = xScale(d);
                return (startPos + endPos) / 2;
            })
            .attr("y", 15)
            .attr("text-anchor", "middle")
            .attr("fill", "currentColor")
            .style("font-size", "12px")
            .text(d3.utcFormat("%b"));
    }

    // -------------------------------------------------------------------------
    // Map Initialization & Update Functions
    // -------------------------------------------------------------------------

    /**
 * Initializes the D3 map, projection, and static elements.
 * Runs only once when the `draw` function is first called.
 */
    const initializeMap = (svg, width, height) => {
        // Reset flag if we are rebuilding
        mapInitialized = true;

        layoutManager.update(width, height);
        projection = d3.geoAlbersUsa();
        path = d3.geoPath().projection(projection);

        const defs = svg.append("defs");
        defs.append("marker")
            .attr("id", "loc-arrowhead")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 7)
            .attr("refY", 0)
            .attr("markerWidth", 5)
            .attr("markerHeight", 5)
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M0,-5L10,0L0,5");

        const mainMapGroup = svg.append("g").attr("class", "main-map-group");
        mainMapGroup.append("g")
            .attr("class", "us-map")
            .on("click", () => {
                d3.select(".city-info-box").style("display", "none");
                if (selectedCityName !== null) {
                    selectedCityName = null;
                    updateCityMarkers();
                    if (isBottomRibbonOpen) drawHoldingCostChart();
                }
            });

        mainMapGroup.append("g").attr("class", "connection-lines");
        mainMapGroup.append("g").attr("class", "optimal-factory-container");
        mainMapGroup.append("g").attr("class", "city-markers");

        d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json").then(us => {
            continentalStatesFeatures = topojson.feature(us, us.objects.states)
                .features.filter(d => d.id !== '02' && d.id !== '15');
            mainMapGroup.select(".us-map").selectAll("path")
                .data(continentalStatesFeatures)
                .enter().append("path")
                .attr("d", path)
                .attr("class", "state-boundary");

            // Ensure map is ready before updating elements
            updateDynamicMapElements();
            runOptimization();
        }).catch(error => {
            console.error("Error loading map topology:", error);
            mapInitialized = false;
        });
    };

    /**
     * Updates all responsive map elements and UI panels based on new dimensions.
     * Called on window resize and on ribbon toggle.
     */
    const updateDynamicMapElements = () => {
        const svgContainer = d3.select("#svg-container").node();
        if (!svgContainer) {
            console.error("updateDynamicMapElements: #svg-container not found!");
            return;
        }

        const { width, height } = svgContainer.getBoundingClientRect();
        if (width <= 0 || height <= 0) {
            console.warn(`updateDynamicMapElements skipped: Invalid dimensions W: ${width}, H: ${height}.`);
            return;
        }

        const svg = d3.select("#location-panel");
        layoutManager.update(width, height, isBottomRibbonOpen);

        // --- Update UI Panel Positions ---
        svg.select(".bottom-ribbon-bar")
            .attr("x", layoutManager.getRibbonRect().x)
            .attr("y", layoutManager.getRibbonRect().y)
            .attr("width", layoutManager.getRibbonRect().width)
            .attr("height", layoutManager.getRibbonRect().height);

        svg.select(".location-controls-wrapper")
            .attr("x", layoutManager.getControlsRect().x)
            .attr("y", layoutManager.getControlsRect().y)
            .attr("width", layoutManager.getControlsRect().width)
            .attr("height", layoutManager.getControlsRect().height);

        svg.select(".summary-panel-wrapper")
            .attr("x", layoutManager.getSummaryRect().x)
            .attr("y", layoutManager.getSummaryRect().y)
            .attr("width", layoutManager.getSummaryRect().width)
            .attr("height", layoutManager.getSummaryRect().height);

        svg.selectAll("g.legend-panel-wrapper")
            .attr("transform", () => {
                const ribbonRect = layoutManager.getRibbonRect();
                const legendY = ribbonRect.y - 150;
                return `translate(10, ${legendY})`;
            });

        svg.select("#ppi-chart-modal")
            .attr("x", layoutManager.getModalRect().x)
            .attr("y", layoutManager.getModalRect().y)
            .attr("width", layoutManager.getModalRect().width)
            .attr("height", layoutManager.getModalRect().height);

        // --- Update Map Projection ---
        if (mapInitialized && continentalStatesFeatures && projection && path) {
            const mapBounds = layoutManager.getMapBounds();

            if (mapBounds.width > 0 && mapBounds.height > 0) {
                projection.fitSize([mapBounds.width, mapBounds.height], { type: "FeatureCollection", features: continentalStatesFeatures });
                const currentTranslate = projection.translate();
                projection.translate([currentTranslate[0], currentTranslate[1] + mapBounds.y]);

                path.projection(projection);

                // --- Redraw/Update Map Elements ---
                d3.select(".us-map").selectAll("path").attr("d", path);
                radiusScale = d3.scaleSqrt().domain([100, 100000]).range([4, 25]).clamp(true);

                updateCityMarkers();
                updateOptimalFactoryMarker();
                setTimeout(() => updateConnectionLines(), 750);

            } else {
                console.warn("updateDynamicMapElements skipped map update: mapBounds have zero dimensions.");
            }

        } else {
            console.warn("updateDynamicMapElements skipped map update: Map not ready.");
        }
    };

    /**
    * Main entry point. Draws the entire Location tab UI, initializes the map,
    * and sets up the simulation worker.
    */
    const draw = () => {

        const locationPanelElement = document.getElementById("location-panel");
        if (!locationPanelElement) {
            console.error("CRITICAL ERROR: SVG element #location-panel not found.");
            const container = document.getElementById('svg-container');
            if (container) container.innerHTML = '<p style="color:red; padding:20px; text-align:center;">Error loading Location tab: Missing required SVG element (#location-panel).</p>';
            return;
        }

        const svg = d3.select(locationPanelElement);
        const svgContainer = d3.select("#svg-container").node();
        if (!svgContainer) {
            console.error("Container not found.");
            return;
        }

        const { width, height } = svgContainer.getBoundingClientRect();
        if (width === 0 || height === 0) {
            console.warn("LocationTab.draw: SVG container has zero dimensions. Skipping draw.");
            return;
        }

        layoutManager.update(width, height, isBottomRibbonOpen);
        const isSvgEmpty = svg.select("defs").empty();

        // --- Initialize Map (if first time) ---
        if (!mapInitialized || isSvgEmpty) {
            svg.selectAll("*").remove();
            d3.select("body").selectAll(".ppi-tooltip, .holding-cost-tooltip, .factory-tooltip, .city-calc-tooltip, .holding-cost-breakdown-tooltip, .ppi-ribbon-tooltip").remove(); // Clear old tooltips
            mapInitialized = false;
            initializeMap(svg, width, height);
        }

        // --- Initialize Simulation Worker (if first time) ---
        if (!simulationWorker) {
            try {
                simulationWorker = new Worker('simulation.worker.js');

                // --- Worker Message Handler ---
                simulationWorker.onmessage = (e) => {
                    const { type, results, message } = e.data;
                    isSimulationRunning = false;

                    if (type === 'complete') {
                        if (!isValidationRun) {
                            simulationResults = results;
                            simulationError = null;
                        }
                        if (simulationPromiseResolve) simulationPromiseResolve(results);

                    } else if (type === 'error') {
                        const isConflictError = message && message.startsWith("Demand Conflict");
                        if (!isValidationRun) {
                            simulationError = message || "Worker error";
                            console.error("Worker Error:", simulationError);

                            if (!isConflictError) {
                                simulationResults = null;
                            }
                        }
                        if (simulationPromiseReject) simulationPromiseReject(new Error(message || "Worker error"));
                    }

                    simulationPromiseResolve = null;
                    simulationPromiseReject = null;

                    if (isBottomRibbonOpen) drawHoldingCostChart();
                };

                // --- Worker Error Handler ---
                simulationWorker.onerror = (err) => {
                    console.error("Worker onerror:", err);
                    isSimulationRunning = false;
                    const errorMessage = `Worker error: ${err.message}.`;

                    if (!isValidationRun) {
                        simulationError = errorMessage;
                        simulationResults = null;
                    }
                    if (simulationPromiseReject) {
                        simulationPromiseReject(new Error(errorMessage));
                    }

                    simulationPromiseResolve = null;
                    simulationPromiseReject = null;
                    isValidationRun = false;

                    if (isBottomRibbonOpen) drawHoldingCostChart();
                };

            } catch (err) {
                console.error("Failed init worker:", err);
                simulationError = "Could not create worker.";
                if (simulationPromiseReject) simulationPromiseReject(new Error(simulationError));
                simulationPromiseResolve = null;
                simulationPromiseReject = null;
                isValidationRun = false;
                if (isBottomRibbonOpen) drawHoldingCostChart();
            }
        }

        // --- Draw UI Panels (using <foreignObject>) ---
        svg.selectAll("foreignObject").remove();
        svg.selectAll(".legend-panel-wrapper").remove();

        // --- Top-Left Controls (Add City) ---
        const controlsRect = layoutManager.getControlsRect();
        const controls = svg.append("foreignObject")
            .attr("class", "location-controls-wrapper")
            .attr("x", controlsRect.x)
            .attr("y", controlsRect.y)
            .attr("width", controlsRect.width)
            .attr("height", controlsRect.height);

        const controlsDiv = controls.append("xhtml:div").attr("class", "location-controls");

        // --- TOOLTIP SETUP ---
        const generalTooltip = createTooltip('loc-general-tooltip');
        const attachLabelTooltip = (element, text) => {
            element.style("cursor", "help")
                .on("mouseover", (e) => {
                    generalTooltip.style("opacity", 1).html(`<div class="tooltip-row">${text}</div>`);
                    if (typeof positionTooltip === 'function') positionTooltip(generalTooltip, e, 15, -28);
                    else generalTooltip.style("left", (e.pageX + 15) + "px").style("top", (e.pageY - 28) + "px");
                })
                .on("mousemove", (e) => {
                    if (typeof positionTooltip === 'function') positionTooltip(generalTooltip, e, 15, -28);
                    else generalTooltip.style("left", (e.pageX + 15) + "px").style("top", (e.pageY - 28) + "px");
                })
                .on("mouseout", () => generalTooltip.style("opacity", 0));
        };

        const cityGroup = controlsDiv.append("div").attr("class", "input-group");
        const cityLabel = cityGroup.append("label").text("Shipping Hub: City");
        attachLabelTooltip(cityLabel, "The destination city to add to your logistics network.");
        const citySelect = cityGroup.append("select").attr("id", "city-select");
        if (typeof majorCities !== 'undefined') {
            Object.keys(majorCities).sort().forEach(city => citySelect.append("option").attr("value", city).text(city));
        } else {
            console.error("majorCities data is missing.");
        }
        citySelect.property("value", selectedCityInDropdown)
            .on("change", function () {
                selectedCityInDropdown = this.value;
            });

        const demandGroup = controlsDiv.append("div").attr("class", "input-group");
        const demandLabel = demandGroup.append("label").text("Ship Qty");
        attachLabelTooltip(demandLabel, "The number of refrigerators sent in a single shipment to this city.");

        demandGroup.append("div")
            .attr("class", "input-with-unit")
            .append("input")
            .attr("type", "number")
            .attr("id", "shipment-qty")
            .attr("value", "200")
            .attr("min", "1");

        const freqGroup = controlsDiv.append("div").attr("class", "input-group");
        const freqLabel = freqGroup.append("label").text("Freq (Days)");
        attachLabelTooltip(freqLabel, "How often shipments are sent (e.g., every 7 days).");

        freqGroup.append("div")
            .attr("class", "input-with-unit")
            .append("input")
            .attr("type", "number")
            .attr("id", "shipment-freq")
            .attr("value", "7")
            .attr("min", "1");
        controlsDiv.append("button")
            .attr("class", "loc-control-btn")
            .text("Add City")
            .style("transform", "translate(0px,9px)")
            .style("height", "29px")
            .on("click", addCity);
        controlsDiv.append("button")
            .attr("class", "loc-control-btn remove-all-btn")
            .text("Remove All")
            .style("transform", "translate(0px,9px)")
            .style("height", "29px")
            .on("click", removeAllCities);

        // --- City Info Box (hidden by default) ---
        const infoBox = svg.append("foreignObject")
            .attr("width", 200).attr("height", 120)
            .attr("class", "city-info-box")
            .style("display", "none");

        const infoDiv = infoBox.append("xhtml:div");
        infoDiv.append("h4").attr("id", "info-header");
        infoDiv.append("p").attr("id", "info-demand");
        infoDiv.append("p").attr("id", "info-annual-cost");
        infoDiv.append("button").text("Remove City").attr("id", "info-remove-btn")
            .on("click", function () {
                const cityToRemove = d3.select(this).attr("data-city-name");
                removeCity(cityToRemove);
            });

        // --- Top-Right Summary Panel ---
        const summaryRect = layoutManager.getSummaryRect();
        const summaryPanel = svg.append("foreignObject")
            .attr("class", "summary-panel-wrapper")
            .attr("x", summaryRect.x)
            .attr("y", summaryRect.y)
            .attr("width", summaryRect.width)
            .attr("height", summaryRect.height);

        const summaryDiv = summaryPanel.append("xhtml:div").attr("class", "summary-panel");

        const switchGroup = summaryDiv.append("div").attr("class", "inv-button-group");


        const newBtn = switchGroup.append("button").attr("id", "loc-new-btn").text("New")
            .classed('active', optimizationMode === 'New')
            .on('click', async () => {
                if (optimizationMode !== 'New') {
                    optimizationMode = 'New';
                    d3.select("#loc-new-btn").classed('active', true);
                    d3.select("#loc-existing-btn").classed('active', false);
                    await runOptimization();
                    if (typeof updateUI === 'function') updateUI();
                }
            });

        attachLabelTooltip(newBtn, "<strong>Greenfield Analysis:</strong>Calculates the optimal coordinates to minimize total transportation costs, regardless of existing infrastructure.");

        const existBtn = switchGroup.append("button").attr("id", "loc-existing-btn").text("Existing")
            .classed('active', optimizationMode === 'Existing')
            .on('click', async () => {
                if (optimizationMode !== 'Existing') {
                    optimizationMode = 'Existing';
                    d3.select("#loc-new-btn").classed('active', false);
                    d3.select("#loc-existing-btn").classed('active', true);
                    await runOptimization();
                    if (typeof updateUI === 'function') updateUI();
                }
            });

        attachLabelTooltip(existBtn, "<strong>Brownfield Analysis:</strong>Evaluates only the specific city locations currently added to the map and selects the one that minimizes total costs.");

        summaryDiv.append("h4").text("Optimal Summary");
        const locationLbl = summaryDiv.append("div").attr('class', 'summary-row').html(`<span>Location:</span><span id="summary-location">N/A</span>`);
        attachLabelTooltip(locationLbl, "The Optimal Location for the Factory.");
        const shipCostLbl = summaryDiv.append("div").attr('class', 'summary-row').html(`<span>Ship Cost:</span><span id="summary-ship-cost">$0</span>`);
        attachLabelTooltip(shipCostLbl, "The Estimated Annual Shipping Cost to all Distribution Centers.");
        const shipLbl = summaryDiv.append("div").attr('class', 'summary-row').html(`<span># Shipments:</span><span id="summary-shipments">0</span>`);
        attachLabelTooltip(shipLbl, "The Total Trucks needed to be scheduled over the Year.");
        const costLbl = summaryDiv.append("div").attr('class', 'summary-row summary-total').html(`<span>Total Cost:</span><span id="summary-total-cost">$0</span>`);
        attachLabelTooltip(costLbl, "The sum of Annual Shipping, Inventory Holding, and Production Exception Costs.");
        const avgCostLbl = summaryDiv.append("div").attr('class', 'summary-row').html(`<span>Avg Cost/Unit:</span><span id="summary-avg-cost">$0.00</span>`);
        attachLabelTooltip(avgCostLbl, "The impact of these operational costs on each unit producted.");
        const wagesLbl = summaryDiv.append("div").attr('class', 'summary-row').html(`<span>Median Wage:</span><span id="loc-wage-display">${_currentWageDisplay}</span>`);
        attachLabelTooltip(wagesLbl, "The Median Wage for Production Workers in the designated City.");

        // --- Legend Panel ---
        const legendRibbonRect = layoutManager.getRibbonRect();
        const legendRect = {
            x: 10,
            y: legendRibbonRect.y - 150,
            width: 200,
            height: 140
        };

        // Legend group
        const legend = svg.append("g")
            .attr("class", "legend-panel-wrapper")
            .attr("transform", `translate(${legendRect.x}, ${legendRect.y})`);

        // Legend box
        legend.append("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", 220)
            .attr("height", 140)
            .attr("rx", 5)
            .classed("legend-box", true)
            .style("pointer-events", "auto");

        // Title
        legend.append("text")
            .text("Legend")
            .attr("x", 110)
            .attr("y", 20)
            .classed("legend-title", true);

        // --- 1. Fix coordinates in legendItems (x: 15 instead of -5) ---
        const legendItems = [
            { type: "star", label: "Optimal Factory Location", y: 40, x: 0 },
            { type: "text", label: "City Size ∝ Annual Shipping Volume", y: 65 },
            { type: "line", width: 2, label: "Low Cost", y: 90, x: 15 },
            { type: "line", width: 6, label: "High Cost", y: 90, x: 115 },
            { type: "text", label: "Line Width ∝ Annual Shipping Cost", y: 110 },
            { type: "text", label: "Line Gaps ∝ Shipping Frequency", y: 130 }
        ];

        // --- 2. Update the rendering loop ---
        legendItems.forEach(item => {
            if (item.type === "line") {
                const lineEndX = item.x + 30;

                legend.append("line")
                    .attr("x1", item.x)
                    .attr("y1", item.y - 2)
                    .attr("x2", lineEndX)
                    .attr("y2", item.y - 2)
                    .style("stroke", "var(--secondary1)")
                    .style("stroke-width", item.width);

                // Calculate dynamic arrow dimensions based on line width
                const arrowLen = 4 + (2 * item.width);
                const arrowHalfWidth = 2 + (1.7 * item.width);

                // Manual Triangle (Arrowhead) at the end of the line
                legend.append("path")
                    .attr("d", `M-${arrowLen},-${arrowHalfWidth} L0,0 L-${arrowLen},${arrowHalfWidth}`)
                    .attr("transform", `translate(${lineEndX + item.width}, ${item.y - 2})`)
                    .style("fill", "var(--secondary1)")
                    .style("stroke", "none");

            } else if (item.type === "star") {
                const starGenerator = d3.symbol().type(d3.symbolStar).size(200);

                legend.append("path")
                    .attr("d", starGenerator())
                    .attr("transform", `translate(25, ${item.y})`)
                    .style("fill", "var(--secondary1)");
            }

            // Draw Label Text
            legend.append("text")
                .text(item.label)
                .attr("x", item.type === "text" ? 10 : item.x + 40)
                .attr("y", item.y + 3)
                .attr("font-weight", "bold")
                .style("font-size", "0.75rem")
                .classed("legend-item-text", true);
        });

        // --- Bottom Ribbon ---
        const ribbonRect = layoutManager.getRibbonRect();
        const ribbon = svg.append("foreignObject")
            .attr("class", "bottom-ribbon-bar")
            .attr("x", ribbonRect.x)
            .attr("y", ribbonRect.y)
            .attr("width", ribbonRect.width)
            .attr("height", ribbonRect.height);

        const ribbonDiv = ribbon.append("xhtml:div").attr("class", "bottom-ribbon-container");

        // Ribbon Header (clickable)
        const ribbonHeader = ribbonDiv.append("div").attr("class", "bottom-ribbon-header")
            .on("click", toggleBottomRibbon);
        ribbonHeader.append("div").attr("class", "bottom-ribbon-header-title")
            .html(`Simulation: <strong>${holdingChartMode === 'inventory' ? 'Inventory' : 'Shipments'}</strong>`);
        ribbonHeader.append("div").attr("class", "bottom-ribbon-header-arrow")
            .html(isBottomRibbonOpen ? '▼' : '▲');
        ribbonHeader.append("button")
            .attr("class", "ribbon-export-btn")
            .html("Export Schedule")
            .attr("title", "Download daily simulation data")
            .on("click", (event) => {
                event.stopPropagation();
                exportSimulationCSV();
            });

        // Ribbon Content (collapsible)
        const ribbonContent = ribbonDiv.append("div").attr("class", "bottom-ribbon-content")
            .style("display", isBottomRibbonOpen ? "flex" : "none");

        // Ribbon Content: Left Panel (Cost Inputs)
        const costInputDiv = ribbonContent.append("div").attr("class", "ribbon-cost-inputs");
        costInputDiv.append("h4").text("Cost Inputs");

        const holdingGroup = costInputDiv.append("div").attr("class", "user-input-row");
        const holdingLabel = holdingGroup.append("label").attr("for", "loc-holding-cost-input").text("Annual Hold Cost (%)");
        holdingGroup.append("input").attr("type", "number").attr("id", "loc-holding-cost-input").attr("value", 25).attr("step", "0.1")
            .on("change", () => {
                runOptimization();
                runDailyInventorySimulation().catch(e => console.warn("Sim failed after cost change:", e));
            })
            .on("input", function () {
                d3.select(this).attr("data-user-modified", "true");
            });

        // Use global tooltip
        const breakdownTooltip = createTooltip('holding-cost-breakdown-tooltip');
        holdingLabel.on("mouseover", (event) => {
            const input = d3.select("#loc-holding-cost-input");
            const breakdown = {
                c: input.attr("data-breakdown-capital") || 0,
                s: input.attr("data-breakdown-storage") || 0,
                v: input.attr("data-breakdown-service") || 0,
                r: input.attr("data-breakdown-risk") || 0,
                t: input.attr("data-estimated-total") || 0
            };

            const html = `
            <div class="tt-title">Estimated Breakdown</div>
            <div class="tooltip-row"><span>Capital:</span><span>${breakdown.c}%</span></div>
            <div class="tooltip-row"><span>Storage:</span><span>${breakdown.s}%</span></div>
            <div class="tooltip-row"><span>Administrative:</span><span>${breakdown.v}%</span></div>
            <div class="tooltip-row"><span>Risk:</span><span>${breakdown.r}%</span></div>
            <hr>
            <div class="tooltip-row tt-total"><span>Total Est:</span><span>${breakdown.t}%</span></div>`;

            breakdownTooltip.style("opacity", 1).html(html);
            if (typeof positionTooltip === 'function') positionTooltip(breakdownTooltip, event, 15, -28);
        })
            .on("mousemove", (event) => {
                if (typeof positionTooltip === 'function') {
                    positionTooltip(breakdownTooltip, event, 15, -28);
                } else {
                    // Fallback if helper isn't available
                    breakdownTooltip
                        .style("left", (event.pageX + 15) + "px")
                        .style("top", (event.pageY - 28) + "px");
                }
            })
            .on("mouseout", () => breakdownTooltip.style("opacity", 0));

        const ppiGroup = costInputDiv.append("div").attr("class", "user-input-row");
        const ppiLabel = ppiGroup.append("label").attr("for", "loc-ppi-input").text("Producer Price Index");
        const ppiTooltip = createTooltip('ppi-ribbon-tooltip');
        ppiLabel.on("mouseover", (event) => {
            ppiTooltip.style("opacity", 1).html(
                `<strong>Producer Price Index (PPI)</strong><br>` +
                `Measures the average change in selling prices received by domestic producers. This value directly scales all LTL (Less-Than-Truckload) and FTL (Full-Truckload) shipping costs.`
            );
        })
            .on("mousemove", (event) => ppiTooltip
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px")
            )
            .on("mouseout", () => ppiTooltip.style("opacity", 0));

        ppiGroup.append("input").attr("type", "number").attr("id", "loc-ppi-input").attr("value", PPI).attr("step", "0.1")
            .on("change", function () {
                PPI = +this.value;
                runOptimization();
            });

        // Attach shared input behaviors (commit semantics, drag-to-change, ctrl-reset)
        setTimeout(() => {
            try {
                const holdingEl = document.getElementById('loc-holding-cost-input');
                const ppiEl = document.getElementById('loc-ppi-input');
                const inputs = [holdingEl, ppiEl].filter(Boolean);

                if (inputs.length) {
                    attachCommitBehavior(inputs, (id, value) => {
                        if (id === 'loc-holding-cost-input') {
                            try { refreshHoldingCost(); } catch (e) { /* noop */ }
                            try { runOptimization(); } catch (e) { /* noop */ }
                            try { runDailyInventorySimulation().catch(e => console.warn("Sim failed after holding cost commit:", e)); } catch (e) { /* noop */ }
                        } else if (id === 'loc-ppi-input') {
                            PPI = value;
                            try { runOptimization(); } catch (e) { /* noop */ }
                        }
                    });

                    inputs.forEach(inp => {
                        try { enableMiddleDragNumberInput(inp, 1, 1); } catch (e) { /* ignore if unavailable */ }

                        inp.addEventListener('click', function (e) {
                            if (e.ctrlKey) {
                                const primaryColor = getComputedStyle(root).getPropertyValue('--primary').trim();
                                if (this.id === 'loc-holding-cost-input') {
                                    this.value = 39.9;
                                    commitInput(this, (id, v) => {
                                        try { refreshHoldingCost(); } catch (e) { }
                                        try { runOptimization(); } catch (e) { }
                                        try { runDailyInventorySimulation().catch(e => console.warn("Sim failed after holding cost ctrl reset:", e)); } catch (e) { }
                                    });
                                    this.style.backgroundColor = primaryColor;
                                    setTimeout(() => { this.style.backgroundColor = ''; }, 200);
                                } else if (this.id === 'loc-ppi-input') {
                                    const defaultPpi = 170;
                                    this.value = defaultPpi;
                                    commitInput(this, (id, v) => { PPI = v; try { runOptimization(); } catch (e) { } });
                                    this.style.backgroundColor = primaryColor;
                                    setTimeout(() => { this.style.backgroundColor = ''; }, 200);
                                }
                            }
                        });
                    });
                }
            } catch (err) {
                console.error('Failed to attach cost input behaviors:', err);
            }
        }, 10);
        const buttonGroup = costInputDiv.append("div").attr("class", "user-input-buttons");
        buttonGroup.append("button").attr("class", "loc-control-btn").attr("id", "show-ppi-chart-btn").text("What is my PPI?")
            .on("click", () => {
                d3.select("#ppi-chart-modal").style("display", "block");
                drawPPITrendChart();
            });

        const simSwitchGroup = costInputDiv.append("div").attr("class", "inv-button-group sim-chart-switch");
        simSwitchGroup.append("button").attr("id", "sim-inv-btn").text("Inventory")
            .classed('active', holdingChartMode === 'inventory')
            .on('click', () => {
                holdingChartMode = 'inventory';
                updateHoldingChartMode();
            });
        simSwitchGroup.append("button").attr("id", "sim-ship-btn").text("Shipments")
            .classed('active', holdingChartMode === 'shipments')
            .on('click', () => {
                holdingChartMode = 'shipments';
                updateHoldingChartMode();
            });

        // Ribbon Content: Center Panel (Chart)
        const chartAreaDiv = ribbonContent.append("div").attr("class", "ribbon-chart-area");
        chartAreaDiv.append("div").attr("id", "holding-cost-svg-container")
            .append("svg").attr("id", "holding-cost-chart-svg");

        // Ribbon Content: Right Panel (Demand)
        const demandDiv = ribbonContent.append("div").attr("class", "ribbon-demand-panel");
        demandDiv.append("div").attr("id", "metrics-placeholder-in-demand");
        const demandHeader = demandDiv.append("h4").text("Annual Demand");
        attachLabelTooltip(demandHeader, "Annual Forecast metrics derived from the Investment Tab inputs.");

        demandDiv.append("div").attr('class', 'demand-row').html(`<span>P10:</span><span id="demand-p10">0</span>`);
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>P50:</span><span id="demand-p50">0</span>`);
        demandDiv.append("div").attr('class', 'demand-row').html(`<span>P90:</span><span id="demand-p90">0</span>`);
        const allocatedDemand = demandDiv.append("div").attr('class', 'demand-row').html(`<span>Allocated:</span><span id="demand-allocated">0</span>`);
        attachLabelTooltip(allocatedDemand, "The sum of Annual Demand for all cities added to the map.");
        demandDiv.append("div").attr("class", "demand-bar-container").append("div").attr("class", "demand-bar").attr("id", "demand-bar-fill").text("0%");


        // --- PPI Chart Modal (hidden by default) ---
        const modalRect = layoutManager.getModalRect();
        const ppiModal = svg.append("foreignObject")
            .attr("id", "ppi-chart-modal")
            .attr("x", modalRect.x)
            .attr("y", modalRect.y)
            .attr("width", modalRect.width)
            .attr("height", modalRect.height)
            .style("display", "none");

        const ppiModalDiv = ppiModal.append("xhtml:div").attr("class", "modal-content ppi-modal-content");
        ppiModalDiv.append("button").attr("class", "close-btn").html("&times;")
            .on("click", () => d3.select("#ppi-chart-modal").style("display", "none"));
        ppiModalDiv.append("h4").text("PPI: General Freight Trucking");
        ppiModalDiv.append("svg").attr("id", "ppi-chart-svg")
            .attr("preserveAspectRatio", "xMidYMid meet");

        /**
         * Adds a city to the map from the control panel inputs.
         */
        async function addCity() {
            const name = d3.select("#city-select").property("value");
            const qty = parseFloat(d3.select("#shipment-qty").property("value"));
            const freq = parseFloat(d3.select("#shipment-freq").property("value"));

            if (name && qty > 0 && freq > 0) {
                if (typeof majorCities === 'undefined' || !majorCities[name]) {
                    console.error(`Coordinates for "${name}" not found.`);
                    alert(`Error: Data missing for city "${name}".`);
                    return;
                }

                const annualDemand = (qty / freq) * 365.2425;

                cityData.set(name, {
                    name,
                    coordinates: majorCities[name],
                    annualDemand,
                    qty,
                    freq
                });

                updateCityMarkers();
                await runOptimization();
                updateDemandCapacityBox();
                refreshHoldingCost();
                runDailyInventorySimulation().catch(e => console.warn("Sim failed after adding city:", e));

                if (typeof updateUI === 'function') {
                    updateUI();
                }
            } else {
                console.warn("Invalid city/qty/freq.");
            }
        }

        /**
         * Removes a single city from the map and recalculates.
         */
        async function removeCity(cityName) {
            if (cityName && cityData.delete(cityName)) {
                d3.select(".city-info-box").style("display", "none");

                if (selectedCityName === cityName) {
                    selectedCityName = null;
                }

                updateCityMarkers();
                await runOptimization();
                updateDemandCapacityBox();
                refreshHoldingCost();
                runDailyInventorySimulation().catch(e => console.warn("Sim failed after city removal:", e));

                if (isBottomRibbonOpen) drawHoldingCostChart();

                if (typeof updateUI === 'function') {
                    updateUI();
                }
            } else {
                console.warn("Attempted to remove non-existent city:", cityName);
            }
        }

        // --- Initial Data Fetch and UI Updates ---
        fetchDemandData();
        refreshHoldingCost();
        updateDemandCapacityBox();
        updateSummaryPanel();

        // Update map elements only if initialized (prevents errors on first load)
        if (mapInitialized) {
            updateDynamicMapElements();
            runOptimization();
        }

        // Redraw simulation chart if ribbon is open
        if (isBottomRibbonOpen) {
            setTimeout(drawHoldingCostChart, 50);
        }
    };

    // -------------------------------------------------------------------------
    // Data & UI Update Functions
    // -------------------------------------------------------------------------

    /**
     * Fetches demand forecast data from the DOM (set by another tab).
     */
    function fetchDemandData() {
        // Get elements from the "Investment" tab
        const p50Display = document.getElementById('inv-p50Demand');
        const p10Input = document.getElementById('inv-p10Demand');
        const p90Input = document.getElementById('inv-p90Demand');
        const workingDaysInput = document.getElementById('inv-workingDays');

        let p10 = 0, p50 = 0, p90 = 0, workingDaysList = [], workingDaysCount = 250;

        if (p50Display && p10Input && p90Input && workingDaysInput) {
            // Use data from the Investment tab
            p10 = parseFloat(p10Input.value.replace(/,/g, '')) || 0;
            p50 = parseFloat(p50Display.textContent.replace(/,/g, '')) || 0;
            p90 = parseFloat(p90Input.value.replace(/,/g, '')) || 0;
            workingDaysCount = parseFloat(workingDaysInput.value || 250);
            try {
                workingDaysList = JSON.parse(workingDaysInput.dataset.workingDaysList || '[]');
            } catch (e) {
                workingDaysList = [];
                console.error("Error parsing WD list:", e);
            }
        } else {
            // Fallback if elements aren't ready
            console.warn("Using estimated demand. Investment tab elements not found.");
            const daily = parseFloat(document.getElementById('dailyDemand')?.value || 180);
            workingDaysCount = 250;
            const std = 6750;
            p50 = daily * workingDaysCount;
            const halfWidth = 1.28155 * std;
            p90 = p50 + halfWidth;
            p10 = Math.max(0, p50 - halfWidth);

            // Generate default working days list
            const year = new Date().getFullYear();
            const date = new Date(year, 0, 1);
            while (date.getFullYear() === year) {
                const day = date.getDay();
                if (day > 0 && day < 6) workingDaysList.push(date.toISOString().split('T')[0]);
                date.setDate(date.getDate() + 1);
            }
        }

        totalDemandCapacity = { p10, p50, p90, workingDays: workingDaysList };
        updateDemandCapacityBox();
    }

    /**
     * Updates the "Annual Demand" panel in the bottom ribbon.
     */
    function updateDemandCapacityBox() {
        if (!totalDemandCapacity) return;

        const allocated = Array.from(cityData.values()).reduce((sum, city) => sum + city.annualDemand, 0);
        const formatNumber = (num) => isFinite(num) ? Math.round(num).toLocaleString() : 'N/A';
        const isOver = (val) => isFinite(val) && val > 0 && allocated > val;

        // Highlight if allocated > forecast
        d3.select("#demand-p10").text(formatNumber(totalDemandCapacity.p10))
            .style("font-weight", isOver(totalDemandCapacity.p10) ? "bold" : null)
            .style("color", isOver(totalDemandCapacity.p10) ? "var(--failure-color)" : null);

        d3.select("#demand-p50").text(formatNumber(totalDemandCapacity.p50))
            .style("font-weight", isOver(totalDemandCapacity.p50) ? "bold" : null)
            .style("color", isOver(totalDemandCapacity.p50) ? "var(--failure-color)" : null);

        d3.select("#demand-p90").text(formatNumber(totalDemandCapacity.p90))
            .style("font-weight", isOver(totalDemandCapacity.p90) ? "bold" : null)
            .style("color", isOver(totalDemandCapacity.p90) ? "var(--failure-color)" : null);

        d3.select("#demand-allocated").text(formatNumber(allocated));

        // Update progress bar
        const percent = (totalDemandCapacity.p50 > 0 && isFinite(totalDemandCapacity.p50))
            ? Math.max(0, (allocated / totalDemandCapacity.p50) * 100)
            : 0;

        const bar = d3.select("#demand-bar-fill");
        bar.style("width", `${Math.min(percent, 100)}%`)
            .text(`${Math.round(percent)}%`);

        // Bar turns red if over 100%
        bar.style("background-color", percent > 100 ? "var(--failure-color)" : "var(--primary)");
    }

    /**
     * Updates the "Optimal Summary" panel.
     * Combines shipping costs from optimization and holding/exception costs from simulation.
     */
    function updateSummaryPanel() {
        let shipmentCost = 0;
        let totalShipments = 0;
        let totalAllocatedDemand = 0;
        const cities = Array.from(cityData.values());
        let locationText = "N/A";

        if (optimalFactoryLocation && cities.length > 0) {
            shipmentCost = calculateTotalCost(optimalFactoryLocation, cities);

            totalShipments = cities.reduce((sum, city) => {
                const shipmentsPerYear = 365.2425 / Math.max(1, city.freq);
                const details = getShipmentDetails(optimalFactoryLocation, city);
                const trucksPerShipment = details ? details.numFTL + (details.remainderChoice === 'FTL' ? 1 : (details.remainderChoice === 'LTL' ? 1 : 0)) : 0;
                return sum + (shipmentsPerYear * trucksPerShipment);
            }, 0);

            totalAllocatedDemand = cities.reduce((sum, city) => sum + city.annualDemand, 0);

            const lat = optimalFactoryLocation[1].toFixed(2);
            const lon = optimalFactoryLocation[0].toFixed(2);
            const closestCity = cities.find(c => c.coordinates && optimalFactoryLocation &&
                c.coordinates[0] === optimalFactoryLocation[0] &&
                c.coordinates[1] === optimalFactoryLocation[1]);

            locationText = closestCity ? closestCity.name : `${lat}°N, ${Math.abs(lon)}°W`;
        }

        let holdingCost = 0;
        let exceptionCost = 0;
        if (simulationResults) {
            holdingCost = d3.sum(simulationResults, d => d.holdingCost);
            exceptionCost = d3.sum(simulationResults, d => d.exceptionCost);
        }

        const totalCombinedCost = shipmentCost + holdingCost + exceptionCost;

        // This pushes the total cost to the Investment Tab's "Annual Freight & Storage" field
        if (typeof InvestmentTab !== 'undefined' && InvestmentTab.updateState) {
            InvestmentTab.updateState('freightExpense', Math.round(totalCombinedCost));
        }

        const avgCostPerUnit = totalAllocatedDemand > 0 ? totalCombinedCost / totalAllocatedDemand : 0;

        const formatCurrency = (val) => val.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        const formatCurrencySmall = (val) => val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        d3.select("#summary-location").text(locationText);
        d3.select("#summary-ship-cost").text(formatCurrency(shipmentCost));
        d3.select("#summary-shipments").text(Math.round(totalShipments).toLocaleString());
        d3.select("#summary-total-cost").text(formatCurrency(totalCombinedCost));
        d3.select("#summary-avg-cost").text(formatCurrencySmall(avgCostPerUnit));
    }

    /**
    * Updates the optimal factory marker (the star) on the map.
    */
    function updateOptimalFactoryMarker() {
        if (!projection || !mapInitialized) return;

        const container = d3.select(".optimal-factory-container");
        const tooltip = createTooltip('factory-tooltip');
        const data = optimalFactoryLocation ? [optimalFactoryLocation] : [];

        let starSize = 540;
        if (optimalFactoryLocation && radiusScale) {
            const cities = Array.from(cityData.values());
            const match = cities.find(c =>
                Math.abs(c.coordinates[0] - optimalFactoryLocation[0]) < 0.001 &&
                Math.abs(c.coordinates[1] - optimalFactoryLocation[1]) < 0.001
            );

            if (match) {
                const r = radiusScale(match.annualDemand);
                starSize = Math.pow(r * 2.7, 2);
            }
        }

        const symbolGen = d3.symbol(d3.symbolStar, starSize);
        const marker = container.selectAll(".optimal-factory-marker")
            .data(data);

        // Exit
        marker.exit()
            .transition().duration(300)
            .style("opacity", 0)
            .remove();

        // Enter + Merge
        marker.enter().append("path")
            .attr("class", "optimal-factory-marker")
            .attr("d", symbolGen)
            .style("opacity", 0)
            .merge(marker)
            .on("mouseover", (event, d) => {
                const lat = d[1].toFixed(2);
                const lon = d[0].toFixed(2);
                tooltip.style("opacity", 1).html(`Optimal Location:<br>${lat}°N, ${Math.abs(lon)}°W`);
            })
            .on("mousemove", (event) => tooltip
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px")
            )
            .on("mouseout", () => tooltip.style("opacity", 0))
            .transition().duration(500)
            .attr("d", symbolGen)
            .attr("transform", d => `translate(${projection(d)})`)
            .style("opacity", 1);
    }


    /**
     * Updates the city markers (circles) on the map.
     */
    function updateCityMarkers() {
        if (!projection || !mapInitialized || !radiusScale) return;

        const tooltip = createTooltip('city-calc-tooltip');
        const infoBox = d3.select(".city-info-box");
        const markers = d3.select(".city-markers").selectAll(".city-marker")
            .data(Array.from(cityData.values()), d => d.name);

        markers.exit().transition().duration(300).attr("r", 0).remove();

        markers.enter().append("circle")
            .attr("class", "city-marker")
            .attr("r", 0)
            .attr("transform", d => `translate(${projection(d.coordinates)})`)
            .merge(markers)
            .on("mouseover", (event, d) => {
                const details = getShipmentDetails(optimalFactoryLocation, d);
                const costFormat = { style: 'currency', currency: 'USD', maximumFractionDigits: 0 };

                // --- Check selection state for styling ---
                const isSelected = (d.name === selectedCityName);
                const containerStyle = isSelected ? "font-weight:bold; color:var(--secondary1);" : "";
                const headerStyle = isSelected ? "color:var(--secondary1);" : "";

                if (!details || !optimalFactoryLocation) {
                    tooltip.style("opacity", 1).html(`<div style="${containerStyle}"><strong>${d.name}</strong><br>Calculating...</div>`);
                    tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px");
                    return;
                }

                const annualCost = calculateTotalCostForCity(optimalFactoryLocation, d);
                const avgCostPerUnit = d.annualDemand > 0 ? (annualCost / d.annualDemand) : 0;
                let shipmentDetailsHtml = "";

                if (details.remainderChoice === 'Local') {
                    shipmentDetailsHtml = `<div class="tooltip-row"><span>Shipment:</span> <span>Local (No Cost)</span></div>`;
                } else if (details.remainderChoice === 'LTL') {
                    shipmentDetailsHtml = `<div class="tooltip-row"><span>FTL Trucks/Ship:</span> <span>${details.numFTL}</span></div>` +
                        `<div class="tooltip-row"><span>FTL Cost/Ship:</span> <span>${details.costFTL.toLocaleString('en-US', costFormat)}</span></div>` +
                        `<hr style='margin: 2px 0; border-top-color: #555;'>` +
                        `<div class="tooltip-row"><span>LTL Weight/Ship:</span> <span>${details.remainderTons.toFixed(2)} tons</span></div>` +
                        `<div class="tooltip-row"><span>LTL Cost/Ship:</span> <span>${details.costRemainder.toLocaleString('en-US', costFormat)}</span></div>`;
                } else {
                    const totalFTL = details.numFTL + (details.remainderChoice === 'FTL' ? 1 : 0);
                    const totalFTLCost = details.costFTL + (details.remainderChoice === 'FTL' ? details.costRemainder : 0);
                    shipmentDetailsHtml = `<div class="tooltip-row"><span>FTL Trucks/Ship:</span> <span>${totalFTL}</span></div>` +
                        `<div class="tooltip-row"><span>FTL Cost/Ship:</span> <span>${totalFTLCost.toLocaleString('en-US', costFormat)}</span></div>`;
                }

                // Apply style wrapper to the entire content
                tooltip.style("opacity", 1).html(
                    `<div style="${containerStyle}">` +
                    `<div class="tooltip-header" style="${headerStyle}">${d.name} Details</div>` +
                    `<div class="tooltip-row"><span>Est. Road Dist:</span> <span>${details.roadDistance.toFixed(0)} mi</span></div>` +
                    `<hr style='margin: 2px 0; border-top-color: #555;'>` +
                    `${shipmentDetailsHtml}` +
                    `<hr style='margin: 2px 0; border-top-color: #555;'>` +
                    `<div class="tooltip-row"><span>Annual Qty:</span> <span>${Math.round(d.annualDemand).toLocaleString()}</span></div>` +
                    `<div class="tooltip-row"><span>Annual Cost:</span> <span>${annualCost.toLocaleString('en-US', costFormat)}</span></div>` +
                    `<div class="tooltip-row"><span>Avg Cost/Unit:</span> <span>${avgCostPerUnit.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</span></div>` +
                    `</div>`
                );
            })
            .on("mousemove", (event) => tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px"))
            .on("mouseout", () => tooltip.style("opacity", 0))
            .on("click", (event, d) => {
                event.stopPropagation();
                if (selectedCityName === d.name) {
                    selectedCityName = null;
                    infoBox.style("display", "none");
                } else {
                    selectedCityName = d.name;
                }
                updateCityMarkers();
                if (isBottomRibbonOpen) drawHoldingCostChart();

                if (!selectedCityName) return;
                if (!projection) return;
                const projectedCoords = projection(d.coordinates);
                if (!projectedCoords) return;

                const [x, y] = projectedCoords;
                const annualCost = calculateTotalCostForCity(optimalFactoryLocation, d);

                infoBox.select("#info-header").text(d.name);
                infoBox.select("#info-demand").text(`Demand: ${d.qty} u / ${d.freq} days`).style("font-weight", "600");
                infoBox.select("#info-annual-cost").text(`Annual Cost: ${annualCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`).style("font-weight", "600");
                infoBox.select("#info-remove-btn").attr("data-city-name", d.name).style("font-weight", "600");

                const mainAreaRect = layoutManager.getMainAreaRect();
                let infoX = x + 15;
                let infoY = y - 15;
                const infoBoxWidth = 200;
                const infoBoxHeight = 120;

                if (infoX + infoBoxWidth > mainAreaRect.width) infoX = x - infoBoxWidth - 15;
                if (infoY < 0) infoY = y + 15;
                if (infoY + infoBoxHeight > mainAreaRect.height) infoY = y - infoBoxHeight - 15;

                infoBox.attr("x", infoX).attr("y", infoY).style("display", "block");
            })
            .on("contextmenu", (event, d) => {
                event.preventDefault();
                removeCity(d.name);
            })
            .style("fill", d => (d.name === selectedCityName) ? "var(--secondary1)" : "var(--secondary2)")
            .transition().duration(500)
            .attr("r", d => radiusScale(d.annualDemand))
            .attr("transform", d => `translate(${projection(d.coordinates)})`);
    }

    /**
     * Removes a single city from the map and recalculates.
     */
    function removeCity(cityName) {
        if (cityName && cityData.delete(cityName)) {
            d3.select(".city-info-box").style("display", "none");

            if (selectedCityName === cityName) {
                selectedCityName = null;
            }

            updateCityMarkers();
            runOptimization();
            updateDemandCapacityBox();
            refreshHoldingCost();
            runDailyInventorySimulation().catch(e => console.warn("Sim failed after city removal:", e));

            if (isBottomRibbonOpen) drawHoldingCostChart();
        } else {
            console.warn("Attempted to remove non-existent city:", cityName);
        }
    }

    /**
     * Removes all cities from the map.
     */
    function removeAllCities() {
        if (cityData.size === 0) return;

        console.log("Removing all cities");
        cityData.clear();
        d3.select(".city-info-box").style("display", "none");
        selectedCityName = null;

        updateCityMarkers();
        runOptimization();
        updateDemandCapacityBox();
        refreshHoldingCost();

        simulationResults = null;
        simulationError = null;
        _localWageStress = 0;
        lastCheckedLocation = null;
        _currentWageDisplay = 'N/A';
        const displayEl = document.getElementById('loc-wage-display');
        if (displayEl) {
            displayEl.textContent = _currentWageDisplay;
        }

        if (isBottomRibbonOpen) drawHoldingCostChart();
    }

    /**
     * Updates the animated connection lines from the factory to the cities.
     */
    function updateConnectionLines() {
        if (!projection || !radiusScale || !mapInitialized) return;

        const lineGroup = d3.select(".connection-lines");
        const cities = Array.from(cityData.values());

        if (!optimalFactoryLocation || cities.length < 2) {
            lineGroup.selectAll(".connection-group").interrupt().remove();
            return;
        }

        const costs = cities.map(city => calculateTotalCostForCity(optimalFactoryLocation, city));
        const maxCost = d3.max(costs);
        const widthScale = d3.scaleLinear().domain([0, maxCost || 1]).range([1, 8]).clamp(true);
        const dashScale = d3.scaleLinear().domain([1, TRUCK_CAPACITY_UNITS * 3]).range([5, 30]).clamp(true);
        const gapScale = d3.scaleLinear().domain([1, 30]).range([15, 100]).clamp(true);

        const groups = lineGroup.selectAll(".connection-group").data(cities, d => d.name);

        groups.exit().selectAll(".connection-line").interrupt();
        groups.exit().remove();

        const enterGroups = groups.enter().append("g").attr("class", "connection-group");
        enterGroups.append("line").attr("class", "connection-line-bg");
        enterGroups.append("line").attr("class", "connection-line");

        enterGroups.merge(groups).each(function (d) {
            const group = d3.select(this);
            const startPoint = projection(optimalFactoryLocation);
            const endPoint = projection(d.coordinates);

            if (!startPoint || !endPoint) {
                group.selectAll('line').style('display', 'none');
                return;
            }

            const radius = radiusScale(d.annualDemand) + 3;
            const dx = endPoint[0] - startPoint[0];
            const dy = endPoint[1] - startPoint[1];
            const lineLength = Math.sqrt(dx * dx + dy * dy);

            if (lineLength < radius) {
                group.selectAll('line').style('display', 'none');
                group.select(".connection-line").interrupt();
                return;
            } else {
                group.selectAll('line').style('display', null);
            }

            const targetX = endPoint[0] - (dx / lineLength) * radius;
            const targetY = endPoint[1] - (dy / lineLength) * radius;
            const strokeWidth = widthScale(calculateTotalCostForCity(optimalFactoryLocation, d));

            // Update background line
            group.select(".connection-line-bg")
                .attr("x1", startPoint[0]).attr("y1", startPoint[1])
                .attr("x2", targetX).attr("y2", targetY)
                .attr("marker-end", "url(#loc-arrowhead)")
                .style("stroke-width", strokeWidth);

            // Update animated line
            const animLine = group.select(".connection-line");
            const currentX2 = parseFloat(animLine.attr("x2"));
            const currentY2 = parseFloat(animLine.attr("y2"));
            const distToTarget = Math.sqrt(Math.pow(currentX2 - targetX, 2) + Math.pow(currentY2 - targetY, 2));

            if (!isNaN(distToTarget) && distToTarget < 2.0) {
                animLine
                    .style("stroke-width", strokeWidth)
                    .attr("x1", startPoint[0]).attr("y1", startPoint[1]);
                return;
            }

            animLine.interrupt();

            const dashArray = `${dashScale(d.qty)} ${gapScale(d.freq)}`;
            const dashTotal = dashScale(d.qty) + gapScale(d.freq);

            animLine
                .attr("x1", startPoint[0]).attr("y1", startPoint[1])
                .attr("x2", startPoint[0]).attr("y2", startPoint[1])
                .style("stroke-width", strokeWidth)
                .attr("marker-end", "url(#loc-arrowhead)")
                .attr("stroke-dasharray", dashArray)
                .attr("stroke-dashoffset", 0);

            const pixelLength = Math.sqrt(dx * dx + dy * dy);
            const growDuration = Math.max(800, Math.min(4000, pixelLength * 2));

            // Animate
            animLine.transition("grow")
                .duration(growDuration)
                .ease(d3.easeLinear)
                .attr("x2", targetX)
                .attr("y2", targetY);

            function repeatMotion() {
                if (!animLine.node()?.isConnected) return;
                animLine
                    .attr("stroke-dashoffset", dashTotal)
                    .transition("move")
                    .ease(d3.easeLinear)
                    .duration(600)
                    .attr("stroke-dashoffset", 0)
                    .on("end", repeatMotion);
            }
            repeatMotion();
        });
    }

    /**
     * Gets detailed shipment cost info for one shipment to one city.
     * @param {Array<number>} factoryCoords - [lon, lat] of factory.
     * @param {object} city - City data object.
     * @param {number} [overrideDistance] - Optional distance to use instead of calculating.
     * @returns {object} Detailed cost breakdown.
     */
    function getShipmentDetails(factoryCoords, city, overrideDistance = null) {
        if (!city?.coordinates || (!factoryCoords && !overrideDistance)) return null;

        const distance = overrideDistance ?? greatCircleDistance(factoryCoords, city.coordinates);

        // If distance is effectively zero, it's a "Local" shipment
        if (distance <= 0.1 && !overrideDistance) {
            return {
                distance,
                roadDistance: 0,
                numFTL: 0,
                costFTL: 0,
                remainderUnits: city.qty,
                remainderTons: 0,
                costRemainder: 0,
                remainderChoice: 'Local',
                costPerShipment: 0
            };
        }

        const roadDistance = distance * getCircuitryFactor(distance);

        // --- FTL (Full Truckload) Calculation ---
        const numFTL = Math.floor(city.qty / TRUCK_CAPACITY_UNITS);
        const costFTL = (numFTL * PPI * roadDistance) / 51.35; // FTL cost formula

        // --- Remainder (LTL vs. FTL) Calculation ---
        const remainderUnits = city.qty % TRUCK_CAPACITY_UNITS;
        const remainderTons = (remainderUnits * DEMAND_UNIT_LBS) / 2000;

        let costRemainder = 0;
        let remainderChoice = "N/A";

        if (remainderTons > 0) {
            const ltlCost = calculateLTLCost(roadDistance, remainderTons);
            const ftlCostForRemainder = (PPI * roadDistance) / 51.35; // Cost of one more FTL truck

            const validLtlCost = isFinite(ltlCost) ? ltlCost : Infinity;
            const validFtlCost = isFinite(ftlCostForRemainder) ? ftlCostForRemainder : Infinity;

            // Choose the cheaper option for the remainder
            costRemainder = Math.min(validLtlCost, validFtlCost);

            if (!isFinite(costRemainder)) {
                costRemainder = 0;
                remainderChoice = "Error";
            } else {
                remainderChoice = (validLtlCost <= validFtlCost) ? "LTL" : "FTL";
            }
        } else {
            remainderChoice = "None";
        }

        return {
            distance,
            roadDistance,
            numFTL,
            costFTL,
            remainderUnits,
            remainderTons,
            costRemainder,
            remainderChoice,
            costPerShipment: costFTL + costRemainder
        };
    }

    /**
     * Calculates the total *annual* shipping cost for a single city.
     */
    function calculateTotalCostForCity(factoryCoords, city) {
        if (!factoryCoords || !city?.coordinates) return 0;

        // Check for local
        if (factoryCoords[0] === city.coordinates[0] && factoryCoords[1] === city.coordinates[1]) {
            return 0;
        }

        const details = getShipmentDetails(factoryCoords, city);
        if (!details || !isFinite(details.costPerShipment)) return 0;

        const shipmentsPerYear = 365.2425 / Math.max(1, city.freq);
        return details.costPerShipment * shipmentsPerYear;
    }

    /**
     * Calculates the total *annual* shipping cost for all cities.
     */
    function calculateTotalCost(factoryCoords, cities) {
        return cities.reduce((total, city) =>
            total + calculateTotalCostForCity(factoryCoords, city),
            0
        );
    }

    /**
     * Resize function called by the global resize handler.
     */
    const resize = () => {
        updateDynamicMapElements();

        // Delay chart redraw slightly to ensure layout reflow is complete after map resize.
        setTimeout(() => {
            if (isBottomRibbonOpen && document.querySelector('.tab-btn.active')?.dataset.tab === 'location') {
                try {
                    drawHoldingCostChart();
                } catch (e) {
                    console.error("Error redrawing holding cost chart on resize:", e);
                }
            }
        }, 400);
    };

    /**
     * Sets the cityData from saved configuration.
     * @param {Array} dataArray - Array of [name, data] pairs.
     */
    const setCityData = (dataArray) => {
        cityData.clear();
        dataArray.forEach(([name, data]) => cityData.set(name, data));
        updateCityMarkers();
        runOptimization();
        updateDemandCapacityBox();
        refreshHoldingCost();
        if (simulationWorker) {
            runDailyInventorySimulation().catch(e => console.warn("Sim failed after loading cityData:", e));
        }
    };

    /**
     * Gets the city data as an array of [name, data] pairs.
     * @returns {Array} Array of [name, data] pairs.
     */
    const getCityData = () => Array.from(cityData.entries());

    /**
     * Gets the current overtime stress factor based on simulation results.
     * This uses a logistic function where the CV penalizes the input
     * @returns {number} Overtime stress factor (0-1).
     */
    const getOvertimeStress = () => {
        if (!simulationResults || simulationResults.length === 0) return 0;

        const N = simulationResults.length; // Total days
        const k_exceptions = simulationResults.filter(d => d.isExceptionDay).length; // Exception days

        if (k_exceptions === 0) return 0.0; // No exceptions, no stress

        const measuredRatio = k_exceptions / N;
        // Get CV from the global stDevPercentage (defined in QualityYield.js)
        const cv = window.stDevPercentage || 0.15;
        const cv_clamped = Math.max(0.0, cv);

        //    The CV penalizes the input by amplifying the measured ratio.
        const effectiveRatio = measuredRatio * (1 + cv_clamped);

        // Define the static, extended S-curve parameters
        const k_steepness = 20;
        const x0_midpoint = 0.20;

        // Calculate the stress using the Logistic function:
        const stress = 1 / (1 + Math.exp(-k_steepness * (effectiveRatio - x0_midpoint)));

        return stress;
    };

    // Expose functions globally
    if (typeof window !== 'undefined') {
        window.setCityData = setCityData;
        window.getCityData = getCityData;
    }

    return {
        draw: draw,
        resize: resize,
        getCityData: getCityData,
        getOvertimeStress: getOvertimeStress,
        getLocalWageStress: () => (window.WageManager ? window.WageManager.getStress() : _localWageStress),
        runOptimization: runOptimization,
        updateLocalWageStress: updateLocalWageStress
    };

})();