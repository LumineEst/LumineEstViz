const drawInvestmentPanel = (function () {

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const context = this;
            const later = function () {
                timeout = null;
                func.apply(context, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // --- STATE MANAGEMENT ---
    const investmentState = {
        analysisPeriod: 5,
        marr: 12.0,
        taxRate: 25.0,
        workingDays: [],
        mfgOverhead: 250000,
        sgaExpenses: 350000,
        freightExpense: 300000,
        costPerFootStraight: 225,
        costPerBend: 450,
        installationCost: 10000,
        salvageValue: 10000,
        runExpansionCase: false,
        std: 6804,
        cv: 15.0,
        ciLevel: 95,
        p90Demand: 0,
        p50Demand: 0,
        p10Demand: 0,
        currentYear: new Date().getFullYear(),
        isCalendarInitialized: false
    };

    const MACRS_RATES = { '5-year': [0.2000, 0.3200, 0.1920, 0.1152, 0.1152, 0.0576] };
    const Z_SCORE_P90 = 1.28155;
    const CI_Z_SCORES = { 90: 1.645, 95: 1.960, 99: 2.576 };
    let analysisDebounceTimer;
    let lastAnalysisResults = null;
    let investmentTabListenersAttached = false;

    // --- FORMATTING HELPERS ---
    function formatNumberWithCommas(num) {
        if (num === null || num === undefined || isNaN(num)) return '';
        const parts = num.toString().split(".");
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return parts.join(".");
    }

    function parseFormattedNumber(str) {
        if (typeof str === 'number') return str;
        if (!str) return 0;
        return parseFloat(str.replace(/,/g, '')) || 0;
    }

    // --- Calendar Helper Functions ---
    // (Kept separate for brevity, same as previous)
    function toIsoDateString(date) {
        if (date instanceof Date && !isNaN(date)) return date.toISOString().split('T')[0];
        return null;
    }
    function getEasterSunday(year) {
        const a = year % 19, b = Math.floor(year / 100), c = year % 100;
        const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31);
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(year, month - 1, day);
    }
    function getUsFederalHolidays(year) {
        const holidays = new Set();
        const addAdj = (m, d) => { try { const dt = new Date(year, m, d); const dow = dt.getDay(); if (dow === 0) dt.setDate(d + 1); else if (dow === 6) dt.setDate(d - 1); const s = toIsoDateString(dt); if (s) holidays.add(s); } catch (e) { } };
        addAdj(0, 1);
        const easter = getEasterSunday(year); if (easter) holidays.add(toIsoDateString(easter));
        try { const lastMay = new Date(year, 5, 0); const ld = lastMay.getDay(); lastMay.setDate(lastMay.getDate() - (ld === 0 ? 6 : ld - 1)); holidays.add(toIsoDateString(lastMay)); } catch (e) { }
        addAdj(5, 19);
        addAdj(6, 4);
        try { const sept1 = new Date(year, 8, 1); const off = (1 + 7 - sept1.getDay()) % 7; sept1.setDate(1 + (sept1.getDay() === 1 ? 0 : off == 0 ? 7 : off)); holidays.add(toIsoDateString(sept1)); } catch (e) { }
        try { const nov1 = new Date(year, 10, 1); const off = (4 + 7 - nov1.getDay()) % 7; const d = 1 + off + 21; holidays.add(toIsoDateString(new Date(year, 10, d))); } catch (e) { }
        addAdj(11, 24);
        addAdj(11, 25);
        addAdj(11, 31);
        return holidays;
    }
    function initializeDefaultWorkingDays(year) {
        const workingDays = [];
        const holidays = getUsFederalHolidays(year);
        const date = new Date(year, 0, 1);
        while (date.getFullYear() === year) {
            const dayOfWeek = date.getDay();
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                const ds = toIsoDateString(date);
                if (ds && !holidays.has(ds)) workingDays.push(ds);
            }
            date.setDate(date.getDate() + 1);
        }
        investmentState.workingDays = workingDays;
        investmentState.isCalendarInitialized = true;
        investmentState.currentYear = year;
    }

    // --- Calendar Modal Drawing (Same as previous) ---
    function createCalendarModalOnce() {
        if (document.getElementById("inv-calendar-modal")) return;
        const modal = document.createElement('div');
        modal.id = 'inv-calendar-modal';
        modal.className = 'inv-calendar-modal';
        const content = document.createElement('div');
        content.className = 'inv-calendar-content';
        content.id = 'inv-calendar-content-target';
        modal.appendChild(content);
        document.body.appendChild(modal);
    }
    function drawCalendarModal(container, year) {
        container.html("");
        if (investmentState.currentYear !== year || !investmentState.isCalendarInitialized) {
            initializeDefaultWorkingDays(year);
        }
        const workingDaysSet = new Set(investmentState.workingDays);
        const holidays = getUsFederalHolidays(year);
        const header = container.append("div").attr("class", "inv-calendar-header");
        const yearSelectorGroup = header.append("div").style("display", "flex").style("align-items", "center");
        yearSelectorGroup.append("h4").text(`Select Working Days for `).style("margin-right", "10px");
        const yearSelect = yearSelectorGroup.append("select").attr("id", "calendar-year-select").style("font-size", "1em").style("padding", "3px");
        for (let y = 2025; y <= 2035; y++) yearSelect.append("option").attr("value", y).text(y).property("selected", y === year);

        yearSelect.on("change", function () {
            const selectedYear = parseInt(this.value);
            initializeDefaultWorkingDays(selectedYear);
            drawCalendarModal(container, selectedYear);
        });
        header.append("button").attr("class", "close-btn").html("&times;")
            .on("click", () => { const modal = document.getElementById("inv-calendar-modal"); if (modal) modal.style.display = "none"; });
        const grid = container.append("div").attr("class", "calendar-grid-container");
        const daysOfWeek = ["S", "M", "T", "W", "T", "F", "S"];
        for (let month = 0; month < 12; month++) {
            const monthContainer = grid.append("div").attr("class", "calendar-month");
            monthContainer.append("h5").text(new Date(year, month).toLocaleString('default', { month: 'long' }));
            const table = monthContainer.append("table");
            const thead = table.append("thead");
            const tbody = table.append("tbody");
            thead.append("tr").selectAll("th").data(daysOfWeek).join("th").attr("class", "day-header").attr("data-day-index", (d, i) => i).text(d => d)
                .on("click", function () {
                    const dayIndex = parseInt(d3.select(this).attr("data-day-index"));
                    const cellsToToggle = d3.select(this.closest('.calendar-month')).select('tbody').selectAll(`td[data-day-index="${dayIndex}"]:not(.not-current-month)`);
                    const firstCell = cellsToToggle.node(); const shouldAdd = firstCell ? !firstCell.classList.contains('working-day') : false;
                    cellsToToggle.each(function () {
                        const cell = d3.select(this); const dateStr = cell.attr("data-date");
                        if (dateStr) { if (shouldAdd) { cell.classed("working-day", true); workingDaysSet.add(dateStr); } else { cell.classed("working-day", false); workingDaysSet.delete(dateStr); } }
                    });
                });
            const firstDay = new Date(year, month, 1); const lastDay = new Date(year, month + 1, 0); const date = new Date(firstDay); date.setDate(date.getDate() - firstDay.getDay());
            let done = false;
            while (!done) {
                const row = tbody.append("tr");
                for (let i = 0; i < 7; i++) {
                    const cell = row.append("td").text(date.getDate());
                    const dateString = toIsoDateString(date);
                    if (date.getMonth() === month && dateString) {
                        cell.attr("data-date", dateString).attr("data-day-index", i).classed("working-day", workingDaysSet.has(dateString)).classed("holiday", holidays.has(dateString))
                            .on("click", function () {
                                const clickedDateStr = d3.select(this).attr("data-date");
                                if (workingDaysSet.has(clickedDateStr)) { workingDaysSet.delete(clickedDateStr); d3.select(this).classed("working-day", false); }
                                else { workingDaysSet.add(clickedDateStr); d3.select(this).classed("working-day", true); }
                            });
                    } else { cell.classed("not-current-month", true); }
                    if (date.getTime() === lastDay.getTime()) done = true;
                    date.setDate(date.getDate() + 1);
                }
            }
        }
        const controls = container.append("div").attr("class", "calendar-controls");
        controls.append("button").text("Toggle Holidays").on("click", () => {
            const holidayCells = grid.selectAll("td.holiday"); const shouldAdd = holidayCells.nodes().some(node => { const dateStr = node.getAttribute('data-date'); return dateStr && !workingDaysSet.has(dateStr); });
            holidayCells.each(function () {
                const cell = d3.select(this); const dateStr = cell.attr("data-date");
                if (dateStr) { if (shouldAdd) { cell.classed("working-day", true); workingDaysSet.add(dateStr); } else { cell.classed("working-day", false); workingDaysSet.delete(dateStr); } }
            });
        });
        controls.append("button").text("Reset to Default").on("click", () => {
            const selectedYear = parseInt(d3.select("#calendar-year-select").property("value"));
            initializeDefaultWorkingDays(selectedYear); drawCalendarModal(container, selectedYear);
        });
        controls.append("button").attr("class", "apply-btn").text("Apply").on("click", () => {
            investmentState.workingDays = Array.from(workingDaysSet).sort();
            const newCount = investmentState.workingDays.length;
            const hiddenInput = d3.select("#inv-workingDays");
            if (!hiddenInput.empty()) {
                hiddenInput.property("value", newCount).attr("data-working-days-list", JSON.stringify(investmentState.workingDays));
                hiddenInput.node().dispatchEvent(new Event('change', { bubbles: true }));
            }
            d3.select("#inv-workingDays-button")?.text(`${newCount} Days`);
            const modal = document.getElementById("inv-calendar-modal"); if (modal) modal.style.display = "none";
            updateProbabilisticValues('mean');
        });
    }

    function updateDemandUI() {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) {
                const rounded = Math.round(val);
                if (el.type === 'number') { el.value = rounded; } else { el.value = formatNumberWithCommas(rounded); }
                el.dataset.committedValue = el.value;
            }
        };
        setVal('inv-std', investmentState.std);
        setVal('inv-p90Demand', investmentState.p90Demand);
        setVal('inv-p10Demand', investmentState.p10Demand);
        const cvEl = document.getElementById('inv-cv');
        if (cvEl) cvEl.value = investmentState.cv.toFixed(1);
        const p50El = document.getElementById('inv-p50Demand');
        if (p50El) p50El.textContent = formatNumberWithCommas(Math.round(investmentState.p50Demand));
    }

    function getSafeInput(key) {
        const el = document.getElementById(`inv-${key}`);
        if (el) {
            if (el.tagName === 'SELECT') return parseFloat(el.value);
            return parseFloat(el.value.replace(/,/g, '')) || 0;
        }
        return investmentState[key] !== undefined ? investmentState[key] : 0;
    }

    function updateProbabilisticValues(driver) {
        if (investmentState.workingDays.length === 0) { initializeDefaultWorkingDays(new Date().getFullYear()); }
        const dailyDemandEl = document.getElementById('dailyDemand');
        const rawDemand = parseFloat(dailyDemandEl ? dailyDemandEl.value : 180);
        const meanDemand = (isNaN(rawDemand) ? 180 : rawDemand) * investmentState.workingDays.length;
        investmentState.p50Demand = meanDemand;
        let std;
        if (driver === 'p90') {
            if (investmentState.p90Demand < meanDemand) investmentState.p90Demand = meanDemand;
            std = (investmentState.p90Demand - meanDemand) / Z_SCORE_P90;
            investmentState.std = std > 0 ? std : 0;
            investmentState.cv = meanDemand > 0 ? (investmentState.std / meanDemand) * 100 : 0;
        } else if (driver === 'p10') {
            if (investmentState.p10Demand > meanDemand) investmentState.p10Demand = meanDemand;
            std = (meanDemand - investmentState.p10Demand) / Z_SCORE_P90;
            investmentState.std = std > 0 ? std : 0;
            investmentState.cv = meanDemand > 0 ? (investmentState.std / meanDemand) * 100 : 0;
        } else {
            if (driver === 'std') {
                std = investmentState.std;
                investmentState.cv = meanDemand > 0 ? (std / meanDemand) * 100 : 0;
            } else {
                std = (investmentState.cv / 100) * meanDemand;
                investmentState.std = std;
            }
            const z = CI_Z_SCORES[investmentState.ciLevel] || 1.960;
            const halfWidth = z * std;
            investmentState.p90Demand = meanDemand + halfWidth;
            investmentState.p10Demand = meanDemand - halfWidth;
        }
        updateDemandUI();
        clearTimeout(analysisDebounceTimer);
        analysisDebounceTimer = setTimeout(runFullAnalysis, 500);
    }

    window.updateProbabilisticValues = updateProbabilisticValues;

    function calculateNPV(cashFlows, rate) { return cashFlows.reduce((acc, val, i) => acc + val / Math.pow(1 + rate, i), 0); }
    function calculateIRR(cashFlows, maxIter = 100, tolerance = 1e-6) {
        if (!cashFlows || cashFlows.length === 0 || cashFlows[0] >= 0) { return NaN; }
        let lowRate = -0.99, highRate = 9999999.0, midRate = 0, npvLow = calculateNPV(cashFlows, lowRate), npvHigh = calculateNPV(cashFlows, highRate);
        if (npvLow * npvHigh > 0) return NaN;
        for (let i = 0; i < maxIter; i++) {
            midRate = (lowRate + highRate) / 2;
            const npvMid = calculateNPV(cashFlows, midRate);
            if (Math.abs(npvMid) < tolerance) return midRate;
            if (npvLow * npvMid < 0) { highRate = midRate; } else { lowRate = midRate; }
        }
        return midRate;
    }
    function calculatePaybackPeriod(cashFlows) {
        if (!cashFlows || cashFlows.length < 2 || cashFlows[0] >= 0) return 0;
        const initialInvestment = Math.abs(cashFlows[0]);
        let cumulativeCashFlow = 0;
        for (let t = 1; t < cashFlows.length; t++) {
            const lastCumulative = cumulativeCashFlow;
            cumulativeCashFlow += cashFlows[t];
            if (cumulativeCashFlow >= initialInvestment) {
                return (cashFlows[t] <= 0) ? t : (t - 1) + ((initialInvestment - lastCumulative) / cashFlows[t]);
            }
        }
        return Infinity;
    }

    function calculateFinancialScenario(annualUnitDemand) {
        const { analysisPeriod, marr, taxRate, runExpansionCase, salvageValue, installationCost,
            mfgOverhead, sgaExpenses, freightExpense, costPerFootStraight, costPerBend } = investmentState;

        const workingDaysCount = investmentState.workingDays.length || 250;
        const getGlobal = (id, def) => { const el = document.getElementById(id); return el ? (parseFloat(el.value) || def) : def; };

        const finInputs = {
            laborCost: getGlobal('laborCost', 25),
            superSell: getGlobal('superSell', 400), superCogs: getGlobal('superCogs', 375), superRework: getGlobal('superRework', 350),
            ultraSell: getGlobal('ultraSell', 650), ultraCogs: getGlobal('ultraCogs', 590), ultraRework: getGlobal('ultraRework', 500),
            megaSell: getGlobal('megaSell', 1000), megaCogs: getGlobal('megaCogs', 960), megaRework: getGlobal('megaRework', 650)
        };

        const qualityYield = (getGlobal('qualityYieldInput', 100) / 100.0) || 1.0;
        const totalStress = 1.0 - qualityYield;

        // DYNAMIC MODEL PRICE CALCULATIONS
        let avgPrice = 0;
        let avgMatCost = 0;
        let avgReworkCost = 0;

        systemState.models.forEach((m, i) => {
            // Map index to inputs (0->Super, 1->Ultra, 2->Mega fallback)
            let s = 0, c = 0, r = 0;
            if (i === 0) { s = finInputs.superSell; c = finInputs.superCogs; r = finInputs.superRework; }
            else if (i === 1) { s = finInputs.ultraSell; c = finInputs.ultraCogs; r = finInputs.ultraRework; }
            else { s = finInputs.megaSell; c = finInputs.megaCogs; r = finInputs.megaRework; }

            avgPrice += s * m.ratio;
            avgMatCost += c * m.ratio;
            avgReworkCost += r * m.ratio;
        });

        let unitsToProduce = 0, configForReport = {}, initialInvestment = 0, equipmentCostForDepreciation = 0;
        const currentEmployees = getGlobal('numEmployees', 8);
        const baseOpHours = getGlobal('opHours', 15);

        // USE SYSTEM STATE ASSEMBLY LINE LENGTH
        const LINE_LENGTH = systemState.assemblyLineLength || 486;

        if (!runExpansionCase) {
            const dailyDemand = annualUnitDemand / workingDaysCount;
            const metrics = (typeof calculateMetrics === 'function')
                ? calculateMetrics({ dailyDemand, opHours: baseOpHours, numEmployees: currentEmployees }, finInputs, { suppressUI: true })
                : { throughputUnitsPerDay: dailyDemand };

            const maxAnnualCapacity = metrics.throughputUnitsPerDay * workingDaysCount;
            unitsToProduce = Math.min(annualUnitDemand, maxAnnualCapacity);
            configForReport = { name: `${currentEmployees} Workers, ${baseOpHours} hrs/day`, empCount: currentEmployees, opHours: baseOpHours };
            equipmentCostForDepreciation = (costPerFootStraight * LINE_LENGTH) + (costPerBend * ((4 * currentEmployees) - (currentEmployees % 2 === 0 ? 2 : 0))) + installationCost;
            initialInvestment = -equipmentCostForDepreciation;
        } else {
            const optimalConfigResult = findOptimalNPVConfig(annualUnitDemand, finInputs);
            const optimalConfig = { name: `${optimalConfigResult.emp} Workers, ${optimalConfigResult.hrs.toFixed(2)} hrs/day`, empCount: optimalConfigResult.emp, opHours: optimalConfigResult.hrs };
            unitsToProduce = annualUnitDemand;
            configForReport = optimalConfig;
            const oldLineCost = (costPerFootStraight * LINE_LENGTH) + (costPerBend * ((4 * currentEmployees) - (currentEmployees % 2 === 0 ? 2 : 0)));
            const newLineCost = (costPerFootStraight * LINE_LENGTH) + (costPerBend * ((4 * optimalConfig.empCount) - (optimalConfig.empCount % 2 === 0 ? 2 : 0)));
            const adjustment = newLineCost < oldLineCost ? -(salvageValue * ((oldLineCost - newLineCost) / oldLineCost)) : (newLineCost - oldLineCost);
            equipmentCostForDepreciation = newLineCost < oldLineCost ? 0 : adjustment + installationCost;
            initialInvestment = -(installationCost + adjustment);
        }

        const cashFlows = [initialInvestment];
        const scaledMfgOverhead = mfgOverhead * (configForReport.opHours > baseOpHours ? configForReport.opHours / baseOpHours : 1);
        const scaledSgaExpenses = sgaExpenses * (configForReport.opHours > baseOpHours ? configForReport.opHours / baseOpHours : 1);
        const macrsSchedule = MACRS_RATES['5-year'];

        for (let t = 1; t <= analysisPeriod; t++) {
            const revenue = unitsToProduce * avgPrice;
            const totalMaterialCost = unitsToProduce * avgMatCost;
            const laborCost = configForReport.empCount * configForReport.opHours * finInputs.laborCost * workingDaysCount;
            const failedUnits = unitsToProduce * totalStress;
            const reworkCost = failedUnits * avgReworkCost;

            const taxDepreciation = (t - 1 < macrsSchedule.length && equipmentCostForDepreciation > 0) ? equipmentCostForDepreciation * macrsSchedule[t - 1] : 0;
            const ebit = revenue - (totalMaterialCost + laborCost + reworkCost + scaledMfgOverhead + freightExpense + scaledSgaExpenses + taxDepreciation);
            const nopat = ebit - (ebit > 0 ? ebit * (taxRate / 100) : 0);
            cashFlows.push(nopat + taxDepreciation);
        }

        if (equipmentCostForDepreciation > 0 && analysisPeriod > 0) { cashFlows[analysisPeriod] += salvageValue * (1 - (taxRate / 100)); }
        const npv = calculateNPV(cashFlows, marr / 100), irr = calculateIRR(cashFlows), payback = calculatePaybackPeriod(cashFlows);

        return { annualUnitDemand, requiredConfig: configForReport, metrics: { npv, irr, payback, initialInvestment }, cashFlows };
    }

    const handleInvestmentResize = debounce(() => {
        if (lastAnalysisResults && document.getElementById('investment-panel').style.display === 'block') {
            renderInvestmentResults(lastAnalysisResults);
        }
    }, 150);

    function runFullAnalysis() {
        let results;
        try {
            results = Object.fromEntries(Object.entries({ 'P90 (Optimistic)': investmentState.p90Demand, 'P50 (Most Likely)': investmentState.p50Demand, 'P10 (Conservative)': investmentState.p10Demand }).map(([name, demand]) => [name, calculateFinancialScenario(demand)]));
            lastAnalysisResults = results;
        } catch (error) {
            console.error("Error during investment analysis:", error);
            return;
        }
        try {
            const p50Result = results['P50 (Most Likely)'];
            if (typeof updateFinancialSidebar === 'function') {
                updateFinancialSidebar({ npv: p50Result.metrics.npv, irr: p50Result.metrics.irr, payback: p50Result.metrics.payback });
            } else if (typeof window.updateFinancialSidebar === 'function') {
                window.updateFinancialSidebar({ npv: p50Result.metrics.npv, irr: p50Result.metrics.irr, payback: p50Result.metrics.payback });
            }
        } catch (err) { console.error('Failed to call updateFinancialSidebar:', err); }
        const panel = document.getElementById("inv-results-display");
        if (panel && panel.offsetParent !== null) {
            renderInvestmentResults(results);
        }
    }

    function findOptimalNPVConfig(annualUnitDemand, finInputs) {
        const { costPerFootStraight, costPerBend, salvageValue, installationCost, marr } = investmentState;
        const workingDaysCount = investmentState.workingDays.length || 250;
        finInputs.laborCost = isNaN(finInputs.laborCost) ? 25 : finInputs.laborCost;
        const overtimeStress = typeof LocationTab !== 'undefined' && LocationTab.getOvertimeStress ? LocationTab.getOvertimeStress() : 0;
        const wageStress = typeof LocationTab !== 'undefined' && LocationTab.getLocalWageStress ? LocationTab.getLocalWageStress() : 0;
        const metricOptions = { overtimeStress, wageStress, skipQualityYield: false, suppressUI: true };

        let maxNPV = -Infinity;
        let bestConfig = { emp: 0, hrs: 0 };
        const dailyDemand = Math.ceil(annualUnitDemand / workingDaysCount);
        const currentEmployees = parseInt(numEmployeesInput.value) || 8;

        // USE SYSTEM STATE CAPACITIES
        const maxDemandMap = new Map(systemState.capacities.map(c => [c.ws, c.maxDemand]));
        const LINE_LENGTH = systemState.assemblyLineLength || 486;

        for (let numEmployees = 3; numEmployees <= 13; numEmployees++) {
            if (dailyDemand > (maxDemandMap.get(numEmployees) || 0)) continue;

            const tempConfig = { ...state.configData };
            state.configData = originalConfigData;
            const { bottleneckTime, fastestTime } = calculateWorkstationDetails(numEmployees);
            state.configData = tempConfig;

            if (bottleneckTime <= 0 || !isFinite(fastestTime) || fastestTime <= 0) continue;

            const productSpacing = fastestTime * 15;
            const throughputTime = (LINE_LENGTH / productSpacing) * bottleneckTime;
            const totalRequiredMinutes = (dailyDemand > 1 ? (dailyDemand - 1) * bottleneckTime : 0) + throughputTime;
            const minRequiredHours = totalRequiredMinutes / 60;

            if (minRequiredHours > 24) continue;
            const startHours = roundUpToQuarter(minRequiredHours);

            for (let opHours = startHours; opHours <= 24; opHours += 0.25) {
                const metrics = calculateMetrics({ dailyDemand, opHours, numEmployees }, finInputs, metricOptions);
                if (!metrics || metrics.throughputUnitsPerDay < dailyDemand) continue;

                const configForAnalysis = { empCount: numEmployees, opHours: opHours };
                const oldLineCost = (costPerFootStraight * LINE_LENGTH) + (costPerBend * ((4 * currentEmployees) - (currentEmployees % 2 === 0 ? 2 : 0)));
                const newLineCost = (costPerFootStraight * LINE_LENGTH) + (costPerBend * ((4 * configForAnalysis.empCount) - (configForAnalysis.empCount % 2 === 0 ? 2 : 0)));
                const adjustment = newLineCost < oldLineCost ? -(salvageValue * ((oldLineCost - newLineCost) / oldLineCost)) : (newLineCost - oldLineCost);
                const equipmentCostForDepreciation = newLineCost < oldLineCost ? 0 : adjustment + installationCost;
                const initialInvestment = -(installationCost + adjustment);
                const cashFlows = [initialInvestment];

                // DYNAMIC AVG PRICE
                let avgPrice = 0;
                let avgReworkCost = 0;
                let avgMatCost = 0;
                systemState.models.forEach((m, i) => {
                    let s = 0, c = 0, r = 0;
                    if (i === 0) { s = finInputs.superSell; c = finInputs.superCogs; r = finInputs.superRework; }
                    else if (i === 1) { s = finInputs.ultraSell; c = finInputs.ultraCogs; r = finInputs.ultraRework; }
                    else { s = finInputs.megaSell; c = finInputs.megaCogs; r = finInputs.megaRework; }
                    avgPrice += s * m.ratio;
                    avgMatCost += c * m.ratio;
                    avgReworkCost += r * m.ratio;
                });

                const scaledMfgOverhead = investmentState.mfgOverhead * (configForAnalysis.opHours > 15 ? configForAnalysis.opHours / 15 : 1);
                const scaledSgaExpenses = investmentState.sgaExpenses * (configForAnalysis.opHours > 15 ? configForAnalysis.opHours / 15 : 1);
                const macrsSchedule = MACRS_RATES['5-year'];

                for (let t = 1; t <= investmentState.analysisPeriod; t++) {
                    const revenue = annualUnitDemand * avgPrice;
                    const totalMaterialCost = annualUnitDemand * avgMatCost;
                    const laborCost = configForAnalysis.empCount * configForAnalysis.opHours * finInputs.laborCost * workingDaysCount;
                    const totalStress = 1.0 - metrics.qualityYield;
                    const failedUnits = annualUnitDemand * totalStress;
                    const reworkCost = failedUnits * avgReworkCost;

                    const taxDepreciation = (t - 1 < macrsSchedule.length && equipmentCostForDepreciation > 0) ? equipmentCostForDepreciation * macrsSchedule[t - 1] : 0;
                    const ebit = revenue - (totalMaterialCost + laborCost + reworkCost + scaledMfgOverhead + investmentState.freightExpense + scaledSgaExpenses + taxDepreciation);
                    const nopat = ebit - (ebit > 0 ? ebit * (investmentState.taxRate / 100) : 0);
                    cashFlows.push(nopat + taxDepreciation);
                }

                if (equipmentCostForDepreciation > 0 && investmentState.analysisPeriod > 0) {
                    cashFlows[investmentState.analysisPeriod] += salvageValue * (1 - (investmentState.taxRate / 100));
                }

                const currentNPV = calculateNPV(cashFlows, marr / 100);
                if (currentNPV > maxNPV) {
                    maxNPV = currentNPV;
                    bestConfig = { emp: numEmployees, hrs: opHours };
                }
            }
        }
        return bestConfig;
    }

    function renderInvestmentResults(results) {
        if (!results) return;
        const p50Result = results['P50 (Most Likely)'];
        const scorecardData = [
            { label: 'Net Present Value (NPV)', value: p50Result.metrics.npv.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }), isError: p50Result.metrics.npv < 0, tooltip: 'Used to determine the profitability of an investment by comparing the present value of future cash inflows to the initial investment.' },
            { label: 'Internal Rate of Return (IRR)', value: isNaN(p50Result.metrics.irr) ? "No Return" : `${(p50Result.metrics.irr * 100).toFixed(1)}%`, isError: isNaN(p50Result.metrics.irr), tooltip: 'Represents the annual rate of return an investment is expected to yield. Is the discount rate that makes the NPV of all cash flows from the investment equal to zero.' },
            { label: 'Payback Period', value: isFinite(p50Result.metrics.payback) ? `${Math.ceil(p50Result.metrics.payback * 365.2425)} Days` : "Net Loss", isError: !isFinite(p50Result.metrics.payback), tooltip: 'Length of time it takes for an investment to generate enough cash flow to recover its initial cost.' }
        ];

        const tooltip = createTooltip("inv-tooltip");
        const scorecards = d3.select(".inv-scorecard-container").selectAll(".inv-scorecard").data(scorecardData);
        const scorecardsEnter = scorecards.enter().append("div").attr("class", "inv-scorecard");
        scorecardsEnter.append("div").attr("class", "inv-scorecard-label");
        scorecardsEnter.append("div").attr("class", "inv-scorecard-value");
        const scorecardsMerge = scorecardsEnter.merge(scorecards);
        scorecardsMerge.select(".inv-scorecard-label").text(d => d.label);
        scorecardsMerge.select(".inv-scorecard-value").style("color", d => d.isError ? 'var(--failure-color)' : null).text(d => d.value);
        scorecardsMerge.on("mouseover", function (e, d) { tooltip.style("opacity", 1); tooltip.html(`<div class="tooltip-row">${d.tooltip}</div>`); if (typeof positionTooltip === 'function') positionTooltip(tooltip, e, 15, -28); else tooltip.style("left", (e.pageX + 15) + "px").style("top", (e.pageY - 28) + "px"); }).on("mousemove", function (e) { if (typeof positionTooltip === 'function') positionTooltip(tooltip, e, 15, -28); else tooltip.style("left", (e.pageX + 15) + "px").style("top", (e.pageY - 28) + "px"); }).on("mouseout", function () { tooltip.transition().duration(50).style("opacity", 0); });

        const chartContainer = d3.select(".inv-chart-container");
        const chartNode = chartContainer.node();
        if (!chartNode) return;
        const scorecardHeight = 95;
        const parentColumn = d3.select('.inv-results-column').node();
        if (!parentColumn) return;
        const chartContainerHeight = parentColumn.clientHeight - scorecardHeight - 15;
        chartContainer.style('height', `${chartContainerHeight > 0 ? chartContainerHeight : 0}px`);
        const margin = { top: 20, right: 10, bottom: 80, left: 80 };
        const width = chartNode.getBoundingClientRect().width - margin.left - margin.right;
        const height = chartNode.getBoundingClientRect().height - margin.top - margin.bottom;
        if (width <= 0 || height <= 0) return;

        let chartSvg = chartContainer.select("svg");
        let chartG;
        if (chartSvg.empty()) { chartSvg = chartContainer.append("svg"); chartG = chartSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`); chartG.append("g").attr("class", "inv-axis x-axis"); chartG.append("g").attr("class", "inv-axis y-axis"); chartSvg.append("text").attr("class", "inv-axis-label label-x").attr("text-anchor", "middle"); chartSvg.append("text").attr("class", "inv-axis-label label-y").attr("transform", "rotate(-90)").attr("text-anchor", "middle"); chartG.append("line").attr("class", "inv-break-even"); } else { chartG = chartSvg.select("g"); }
        chartSvg.attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`);
        const cumulativeData = Object.entries(results).map(([name, data]) => ({ name, values: data.cashFlows.map((cf, i) => ({ year: i, value: data.cashFlows.slice(0, i + 1).reduce((a, b) => a + b, 0) })) }));
        const x = d3.scaleLinear().domain([0, investmentState.analysisPeriod]).range([0, width]);
        const y = d3.scaleLinear().domain([d3.min(cumulativeData, d => d3.min(d.values, v => v.value)), d3.max(cumulativeData, d => d3.max(d.values, v => v.value))]).nice().range([height, 0]);
        const t = d3.transition().duration(750).ease(d3.easeCubicOut);
        chartG.select(".x-axis").attr("transform", `translate(0,${height})`).transition(t).call(d3.axisBottom(x).ticks(investmentState.analysisPeriod).tickFormat(d3.format("d"))).selectAll("text").style("font-size", '14px');
        chartG.select(".y-axis").transition(t).call(d3.axisLeft(y).tickFormat(d3.format("$,.2s"))).selectAll("text").style("font-size", '14px');
        chartSvg.select(".label-x").attr("x", margin.left + width / 2).attr("y", height + margin.top + 40).text("Analysis Period (Years)");
        chartSvg.select(".label-y").attr("y", margin.left / 4).attr("x", -(margin.top + height / 2)).text("Cumulative Free Cash Flow");
        const p90Data = cumulativeData.find(d => d.name.includes('P90')).values;
        const p50Data = cumulativeData.find(d => d.name.includes('P50')).values;
        const p10Data = cumulativeData.find(d => d.name.includes('P10')).values;
        const areaGen = d3.area().x(d => x(d.year));
        const areas = chartG.selectAll(".inv-area").data([{ data: p90Data, y0: p50Data, fill: getComputedStyle(document.documentElement).getPropertyValue('--primary') }, { data: p50Data, y0: p10Data, fill: getComputedStyle(document.documentElement).getPropertyValue('--secondary2') }]);
        areas.enter().append("path").attr("class", "inv-area").merge(areas).attr("fill", d => d.fill).transition(t).attr("d", d => areaGen.y0((v, i) => y(d.y0[i].value)).y1(v => y(v.value))(d.data));
        const lineGen = d3.line().x(d => x(d.year)).y(d => y(d.value));
        const colorScale = d3.scaleOrdinal().domain(['P90 (Optimistic)', 'P50 (Most Likely)', 'P10 (Conservative)']).range([getComputedStyle(document.documentElement).getPropertyValue('--primary'), getComputedStyle(document.documentElement).getPropertyValue('--secondary1'), getComputedStyle(document.documentElement).getPropertyValue('--secondary2')]);
        const lines = chartG.selectAll(".inv-line").data(cumulativeData);
        lines.enter().append("path").attr("class", "inv-line").merge(lines).style("stroke", d => colorScale(d.name)).style("stroke-width", d => d.name.includes('P50') ? '6px' : '2px').transition(t).attr("d", d => lineGen(d.values));
        const breakEvenLine = chartG.select(".inv-break-even");
        const currentX2 = parseFloat(breakEvenLine.attr("x2")) || 0;
        if (currentX2 <= 0) { breakEvenLine.attr("y1", y(0)).attr("y2", y(0)).attr("x1", 0).attr("x2", 0).transition(t).attr("x2", width); } else { breakEvenLine.transition(t).attr("y1", y(0)).attr("y2", y(0)).attr("x2", width); }
        const chartTooltip = createTooltip("inv-chart-tooltip");
        const hitboxes = chartG.selectAll(".inv-hitbox").data(cumulativeData);
        hitboxes.enter().append("path").attr("class", "inv-hitbox").merge(hitboxes).transition(t).attr("d", d => lineGen(d.values));
        chartG.selectAll(".inv-hitbox").on("mouseover", (e, d) => { chartTooltip.transition().duration(200).style("opacity", 1); const scenarioResult = results[d.name]; const FmtdIRR = isNaN(scenarioResult.metrics.irr) ? "No Return" : `${(scenarioResult.metrics.irr * 100).toFixed(1)}%`; const FmtdPayback = isFinite(scenarioResult.metrics.payback) ? `${Math.ceil(scenarioResult.metrics.payback * 365.2425)} Days` : "Net Loss"; chartTooltip.html(`<div class="tooltip-header">${d.name}</div><div class="tooltip-row"><span>NPV:</span> <strong>${scenarioResult.metrics.npv.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</strong></div><div class="tooltip-row"><span>IRR:</span> <strong>${FmtdIRR}</strong></div><div class="tooltip-row"><span>Payback:</span> <strong>${FmtdPayback}</strong></div><hr><div class="tooltip-row"><span>Config:</span> <strong>${scenarioResult.requiredConfig.name}</strong></div><div class="tooltip-row"><span>Annual Demand:</span> <strong>${scenarioResult.annualUnitDemand.toFixed(0).toLocaleString('en-US')} Units</strong></div>`); }).on("mousemove", (e) => chartTooltip.style("left", (e.pageX + 15) + "px").style("top", (e.pageY - 28) + "px")).on("mouseout", () => chartTooltip.transition().duration(500).style("opacity", 0));
    }

    // ... (Public Methods - Same as before)
    function calculate() { if (!investmentState.isCalendarInitialized) { initializeDefaultWorkingDays(investmentState.currentYear); } updateProbabilisticValues('mean'); }
    async function draw() { /* ... Same draw code ... */
        if (!d3.select("#investment-panel .inv-container").empty()) {
            if (lastAnalysisResults) { renderInvestmentResults(lastAnalysisResults); return; }
            setTimeout(() => updateProbabilisticValues('mean'), 0); return;
        }
        if (!investmentState.isCalendarInitialized) { initializeDefaultWorkingDays(investmentState.currentYear); }
        createCalendarModalOnce();
        window.removeEventListener('appResize', handleInvestmentResize);
        window.addEventListener('appResize', handleInvestmentResize);
        const svg = d3.select("#investment-panel");
        svg.selectAll("*").remove();
        const container = svg.append("foreignObject").attr("width", "100%").attr("height", "100%").append("xhtml:div").attr("class", "inv-container").style("overflow", "hidden");
        const inputColumn = container.append("div").attr("class", "inv-input-column");
        inputColumn.append("h3").attr("class", "inv-column-title").text("Economic Parameters");
        const inputArea = inputColumn.append("div").attr("class", "inv-inputs");
        try {
            const response = await fetch('Pages/investmentInputs.html');
            if (!response.ok) throw new Error(response.statusText);
            inputArea.html(await response.text());
            const workingDaysInput = container.select("#inv-workingDays");
            const label = container.select(`label[for="inv-workingDays"]`);
            if (!workingDaysInput.empty() && !label.empty()) {
                let displayButton = document.getElementById('inv-workingDays-button');
                if (!displayButton) { displayButton = document.createElement('button'); displayButton.id = 'inv-workingDays-button'; displayButton.className = 'inv-calendar-button'; label.node().after(displayButton); }
                const currentCount = investmentState.workingDays.length;
                displayButton.textContent = `${currentCount} Days`;
                workingDaysInput.style("display", "none").property("value", currentCount).attr("data-working-days-list", JSON.stringify(investmentState.workingDays));
                displayButton.replaceWith(displayButton.cloneNode(true));
                displayButton = document.getElementById('inv-workingDays-button');
                if (displayButton) { displayButton.addEventListener('click', (e) => { e.preventDefault(); const modal = document.getElementById("inv-calendar-modal"); if (modal) modal.style.display = "block"; drawCalendarModal(d3.select("#inv-calendar-content-target"), investmentState.currentYear); }); }
            }
            setTimeout(() => {
                const tooltips = { 'inv-analysisPeriod': 'Number of years over which the investment\'s cash flows are projected.', 'inv-marr': 'Minimum Acceptable Rate of Return (MARR) for an investment to be worth it.', 'inv-taxRate': 'Corporate tax rate applied to earnings before tax.', 'inv-workingDays': 'Number of production days in a year.', 'inv-mfgOverhead': 'Annual fixed manufacturing expenses not tied to production (rent, utilties).', 'inv-sgaExpenses': 'Annual fixed selling, general, and administrative expenses (salaries, marketing).', 'inv-freightExpense': 'Annual variable cost of shipping and storing finished goods.', 'inv-costPerFootStraight': 'Capital cost for each linear foot of the straight conveyor belt.', 'inv-costPerBend': 'Capital cost for each 90-degree bend in the conveyor system.', 'inv-installationCost': 'Fixed cost to install the new or modified assembly line.', 'inv-salvageValue': 'Estimated resale value of equipment at the end of analysis period.', 'inv-std': 'Standard Deviation: Expected volatility of annual demand around the expected value.', 'inv-cv': 'Coefficient of Variation: Ratio of STD to the mean, to normalize volatility across means.', 'inv-ciLevel': 'Confidence Interval: Probability that true annual demand falls within the calculated range to the right.', 'inv-p10Demand': 'P10 Demand: Conservative Forecast; there is a 10% Chance of demand being at least this low', 'inv-p90Demand': 'P90 Demand: Optimistic Forecast; there is a 10% Chance of demand being at least this high.' };
                const tooltip = createTooltip("inv-tooltip");
                for (const [id, text] of Object.entries(tooltips)) {
                    const labelElement = container.node().querySelector(`label[for="${id}"]`);
                    if (labelElement) { d3.select(labelElement).on("mouseover", function (e) { tooltip.transition().duration(200).style("opacity", 1); tooltip.html(`<div class="tooltip-row">${text}</div>`); if (typeof positionTooltip === 'function') positionTooltip(tooltip, e, 15, -28); else tooltip.style("left", (e.pageX + 15) + "px").style("top", (e.pageY - 28) + "px"); }).on("mousemove", function (e) { if (typeof positionTooltip === 'function') positionTooltip(tooltip, e, 15, -28); else tooltip.style("left", (e.pageX + 15) + "px").style("top", (e.pageY - 28) + "px"); }).on("mouseout", function () { tooltip.transition().duration(500).style("opacity", 0); }); }
                }
                const btnTooltips = { '#inv-baseCaseBtn': 'Building a new Assembly Line based on current configuration.', '#inv-expansionCaseBtn': 'Modifying an Assembly Line based on current configuration to its optimal configurations based on demand levels.' };
                for (const [selector, text] of Object.entries(btnTooltips)) {
                    const btn = d3.select(selector);
                    if (!btn.empty()) { btn.on("mouseover", function (e) { tooltip.transition().duration(200).style("opacity", 1); tooltip.html(`<div class="tooltip-row">${text}</div>`); if (typeof positionTooltip === 'function') positionTooltip(tooltip, e, 15, -28); else tooltip.style("left", (e.pageX + 15) + "px").style("top", (e.pageY - 28) + "px"); }).on("mousemove", function (e) { if (typeof positionTooltip === 'function') positionTooltip(tooltip, e, 15, -28); else tooltip.style("left", (e.pageX + 15) + "px").style("top", (e.pageY - 28) + "px"); }).on("mouseout", function () { tooltip.transition().duration(500).style("opacity", 0); }); }
                }
            }, 10);
            setTimeout(() => updateProbabilisticValues('mean'), 0);
        } catch (e) { inputArea.html('<p class="error">Could not load input form.</p>'); console.error(e); }
        container.append("div").attr("class", "inv-results-column").html(`<div id="inv-results-placeholder" style="display: none;"></div><div id="inv-results-display"><div class="inv-scorecard-container"></div><div class="inv-chart-container"></div></div>`);
        const spinnerFields = new Set(['analysisPeriod', 'marr', 'taxRate', 'costPerFootStraight', 'costPerBend', 'cv']);
        Object.keys(investmentState).forEach(key => {
            if (key === 'workingDays' || key === 'currentYear' || key === 'isCalendarInitialized') return;
            const el = document.getElementById(`inv-${key}`);
            if (el) {
                if (el.tagName === 'SELECT') { el.value = investmentState[key]; return; }
                if (spinnerFields.has(key)) { el.type = 'number'; el.value = investmentState[key]; el.style.paddingRight = ''; } else {
                    el.type = 'text'; el.value = formatNumberWithCommas(investmentState[key]); el.style.paddingRight = '0.9rem';
                    el.addEventListener('focus', function () { const raw = parseFormattedNumber(this.value); this.value = raw; });
                    el.addEventListener('blur', function () { const raw = parseFormattedNumber(this.value); this.value = formatNumberWithCommas(raw); });
                }
            }
        });
        const invInputs = Array.from(container.node().querySelectorAll("input, select")).filter(el => el && el.id !== 'inv-workingDays');
        if (invInputs.length) {
            attachCommitBehavior(invInputs, (id, value) => {
                const cleanValue = typeof value === 'string' ? parseFormattedNumber(value) : value;
                const key = id.replace('inv-', '');
                if (key in investmentState) { investmentState[key] = cleanValue; }
                if (['std', 'cv', 'p90Demand', 'p10Demand', 'ciLevel'].includes(key)) { updateProbabilisticValues(key.replace('Demand', '')); } else {
                    const isGlobalInput = !(key in investmentState); const debounceTime = isGlobalInput ? 800 : 500;
                    clearTimeout(analysisDebounceTimer);
                    analysisDebounceTimer = setTimeout(() => { if (window.isRecalculating) { analysisDebounceTimer = setTimeout(runFullAnalysis, 200); return; } runFullAnalysis(); }, debounceTime);
                }
            });
            invInputs.forEach(inp => { if (inp.tagName.toLowerCase() === 'input') { try { enableMiddleDragNumberInput(inp, 1, 1); } catch (e) { } } });
        }
        const controlsArea = inputColumn.append("div").attr("class", "inv-analysis-controls");
        controlsArea.html(`<div class="inv-button-group"><button id="inv-baseCaseBtn">Base Case</button><button id="inv-expansionCaseBtn">Expansion Case</button></div>`);
        controlsArea.select('#inv-baseCaseBtn').on('click', () => { if (investmentState.runExpansionCase) { investmentState.runExpansionCase = false; runFullAnalysis(); controlsArea.select('#inv-baseCaseBtn').classed('active', true); controlsArea.select('#inv-expansionCaseBtn').classed('active', false); } });
        controlsArea.select('#inv-expansionCaseBtn').on('click', () => { if (!investmentState.runExpansionCase) { investmentState.runExpansionCase = true; runFullAnalysis(); controlsArea.select('#inv-baseCaseBtn').classed('active', false); controlsArea.select('#inv-expansionCaseBtn').classed('active', true); } });
        controlsArea.select(investmentState.runExpansionCase ? '#inv-expansionCaseBtn' : '#inv-baseCaseBtn').classed('active', true);
        investmentTabListenersAttached = false;
        if (!investmentTabListenersAttached) { investmentTabListenersAttached = true; }
    }
    function updateState(key, value) {
        if (key in investmentState) {
            investmentState[key] = value;
            const el = document.getElementById(`inv-${key}`);
            if (el) { const currentVal = parseFormattedNumber(el.value); if (currentVal !== parseFloat(value)) { if (el.type === 'number') { el.value = value; } else { el.value = formatNumberWithCommas(value); } el.dataset.committedValue = el.value; } }
            if (document.getElementById('investment-panel').style.display === 'block') { clearTimeout(analysisDebounceTimer); analysisDebounceTimer = setTimeout(runFullAnalysis, 100); }
        }
    }

    return { draw, calculate, updateState };
})();

const InvestmentTab = drawInvestmentPanel;