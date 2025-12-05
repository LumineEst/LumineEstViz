/**
 * --------------------------------------------------------------------
 * Factory Physics - Main Application Script
 * --------------------------------------------------------------------
 */

// --- GLOBAL CONSTANTS & STATE ---
const root = document.documentElement; // REQUIRED for Efficiency.js and legacy tabs
const MIN_TAKT_TIME = 2.5;

let systemState = {
    // Defaulting to "Legacy" Refrigerator Data initially
    models: [
        { id: 1, name: "Super", ratio: 0.35, length: 3, width: 3, height: 6, weight: 300 },
        { id: 2, name: "Ultra", ratio: 0.45, length: 3, width: 3, height: 6, weight: 320 },
        { id: 3, name: "Mega", ratio: 0.20, length: 3.5, width: 3.5, height: 7, weight: 400 }
    ],
    elements: [], // Will be populated by loadData() or ConfigManager
    configData: {}, // Optimization Results
    capacities: [], // Thresholds
    assemblyLineLength: 486, // Dynamically calculated
    productDimensions: { maxShortestDim: 3.5 }
};

// --- Geographic Data for Location Tab ---
const majorCities = {
    "New York, NY": [-74.0060, 40.7128],
    "Los Angeles, CA": [-118.2437, 34.0522],
    "Chicago, IL": [-87.6298, 41.8781],
    "Houston, TX": [-95.3698, 29.7604],
    "Phoenix, AZ": [-112.0740, 33.4484],
    "Philadelphia, PA": [-75.1652, 39.9526],
    "San Antonio, TX": [-98.4936, 29.4241],
    "San Diego, CA": [-117.1611, 32.7157],
    "Dallas, TX": [-96.7970, 32.7767],
    "Columbus, OH": [-82.9988, 39.9612],
    "Charlotte, NC": [-80.8431, 35.2271],
    "Indianapolis, IN": [-86.1581, 39.7684],
    "Jacksonville, FL": [-81.6557, 30.3322],
    "San Francisco, CA": [-122.4194, 37.7749],
    "Seattle, WA": [-122.3321, 47.6062],
    "Denver, CO": [-104.9903, 39.7392],
    "Washington, D.C.": [-77.0369, 38.9072],
    "Boston, MA": [-71.0589, 42.3601],
    "Detroit, MI": [-83.0458, 42.3314],
    "Memphis, TN": [-90.0490, 35.1495],
    "Salt Lake City, UT": [-111.8910, 40.7608],
    "Las Vegas, NV": [-115.1398, 36.1699],
    "St. Louis, MO": [-90.1994, 38.6270],
    "Miami, FL": [-80.1918, 25.7617],
    "Atlanta, GA": [-84.3880, 33.7490]
};

let isRecalculating = false;
let autoAdjustEnabled = true;
let investmentMetricsInitialized = false;
let targetSalesDemand = 0;
let allowInputCommitCallbacks = false;

// Live state mirrors inputs for fast access
const liveState = {
    dailyDemand: 180,
    opHours: 15.0,
    numEmployees: 8,
    laborCost: 25.0,
    superSell: 400, superCogs: 375, superRework: 350,
    ultraSell: 650, ultraCogs: 590, ultraRework: 500,
    megaSell: 1000, megaCogs: 960, megaRework: 650,
    qualityYieldInput: 100.0,
    qualityStDevPercentage: 0.15
};

// Fallback logic for legacy coloring
const PERT_PIE_COLORS = {
    super: '#8ac9f3',
    ultra: '#f3de8a',
    mega: '#e98f85',
    idle: '#e5e7e9'
};

const originalConfigData = {};
const state = {
    taskData: new Map(), // UI Lookup Map
    configData: {}       // Pointer to active config
};

// Modules
const { draw: drawPrecedenceChart, update: updatePrecedenceChart, flatten: flattenPrecedenceTree } = PrecedenceTab;

let sortableInstances = [];
let invalidPrecedenceNodes = new Set();
let profitMaximizationCache = { key: null, data: null };
let isProfitCalculating = false;
let animationState = {
    speedMultiplier: 1.0,
    layout: { frameId: null, isRunning: false, isPaused: false, isManuallyPaused: false },
    schedule: { frameId: null, isRunning: false, isPaused: false, isManuallyPaused: false },
    speedo: { currentAngle: 0 }
};

// UI Elements
const dailyDemandInput = document.getElementById('dailyDemand');
const opHoursInput = document.getElementById('opHours');
const numEmployeesInput = document.getElementById('numEmployees');
const employeeCountDisplay = document.getElementById('employeeCountDisplay');
const laborCostInput = document.getElementById('laborCost');
const superSellInput = document.getElementById('superSell');
const superCogsInput = document.getElementById('superCogs');
const superReworkInput = document.getElementById('superRework');
const ultraSellInput = document.getElementById('ultraSell');
const ultraCogsInput = document.getElementById('ultraCogs');
const ultraReworkInput = document.getElementById('ultraRework');
const megaSellInput = document.getElementById('megaSell');
const megaCogsInput = document.getElementById('megaCogs');
const megaReworkInput = document.getElementById('megaRework');
const qualityYieldInput = document.getElementById('qualityYieldInput');
const qualityStDevPercentageInput = document.getElementById('qualityStDevPercentage');
const qualityStDevPercentageDisplay = document.getElementById('qualityStDevPercentageDisplay');
const copqEl = document.getElementById('copq');
window.lastQualityBreakdown = {};

const wipEl = document.getElementById('wip');
const throughputEl = document.getElementById('throughput');
const conveyorSpeedEl = document.getElementById('conveyorSpeed');
const productSpacingEl = document.getElementById('productSpacing');
const grossProfitEl = document.getElementById('grossProfit');
const profitMarginEl = document.getElementById('profitMargin');
const demandStatusEl = document.getElementById('demandStatus');
const avgEfficiencyEl = document.getElementById('avgEfficiency');
const totalIdleTimeEl = document.getElementById('totalIdleTime');
const balanceDelayEl = document.getElementById('balanceDelay');
const idleTimeCvEl = document.getElementById('idleTimeCv');
const qualityYieldEl = document.getElementById('qualityYield');
const leftSidebar = document.getElementById('left-sidebar');
const rightSidebar = document.getElementById('right-sidebar');
const leftToggle = document.getElementById('left-toggle');
const rightToggle = document.getElementById('right-toggle');
const tabs = document.getElementById('tabs');
const visPanels = document.querySelectorAll('.vis-panel');
const workstationList = document.getElementById('workstation-list');

// Save/Compare elements
const saveConfigBtn = document.getElementById('saveConfigBtn');
const compareBtn = document.getElementById('compareBtn');
const LOCAL_SAVE_KEY = 'factoryFlowSavedConfig';
let lastSavedConfig = null;
let isCompareMode = false;
let isSavedMode = false;
let currentView = 'current';

/**
* --------------------------------------------------------------------
* Initialization
* --------------------------------------------------------------------
*/
async function main() {
    injectCustomStyles();
    await loadConfigModal();

    await loadData();
    syncLiveState();

    setupEventListeners();
    setupUIEventListeners();
    setupVisibilityListener();

    state.invalidPrecedenceMap = validatePrecedence();
    invalidPrecedenceNodes = new Set(Array.from(state.invalidPrecedenceMap.keys()));
    restoreActiveTab();
    setWorkstationListHeight();

    document.querySelectorAll("input[type='number']").forEach(input => {
        enableMiddleDragNumberInput(input, 1, 1);
    });
    document.querySelectorAll("input[type='range']").forEach(input => {
        enableMiddleDragNumberInput(input, 1, 1);
    });

    try {
        wireRightSidebarTooltips();
    } catch (err) {
        console.error('Failed to attach tooltips:', err);
    }

    updateUI();

    if (typeof InvestmentTab !== 'undefined' && typeof InvestmentTab.calculate === 'function') {
        InvestmentTab.calculate();
    }
    runProfitCalculation();
    try { if (typeof updateCompareBtn === 'function') updateCompareBtn(); } catch (e) { }
    allowInputCommitCallbacks = true;
}

/**
 * Loads data from SessionStorage (Custom) or CSVs (Legacy).
 */
async function loadData() {
    try {
        const customConfig = sessionStorage.getItem("customSystemConfig");

        if (customConfig) {
            console.log("Loading Custom Configuration...");
            const parsed = JSON.parse(customConfig);
            systemState.models = parsed.models;
            systemState.elements = parsed.elements;
            systemState.configData = parsed.configData;

            calculateAssemblyLineLength();
            calculateCapacityThresholds();

        } else {
            console.log("Loading Default Legacy Data...");
            const [pertData, configsRaw] = await Promise.all([
                d3.csv("Data/PERT.csv"),
                d3.csv("Data/CONFIGS.csv")
            ]);

            // Map Legacy PERT
            systemState.elements = pertData.map(d => ({
                id: parseInt(d.Element),
                description: d.Description,
                baseTime: parseFloat(d.Labor_Time),
                predecessors: [], // Populated below
                usage: [
                    parseFloat(d.Super) > 0 ? 1 : null,
                    parseFloat(d.Ultra) > 0 ? 2 : null,
                    parseFloat(d.Mega) > 0 ? 3 : null
                ].filter(Boolean)
            }));

            // Map Precedence from Logic (Legacy CSV doesn't strictly have it formatted)
            const legacyPrecedence = [
                { id: 1, predecessors: [] }, { id: 2, predecessors: [1] }, { id: 3, predecessors: [1] }, { id: 4, predecessors: [1] },
                { id: 5, predecessors: [2, 3] }, { id: 6, predecessors: [1] }, { id: 7, predecessors: [6] }, { id: 8, predecessors: [1] },
                { id: 9, predecessors: [8] }, { id: 10, predecessors: [1] }, { id: 11, predecessors: [1] }, { id: 12, predecessors: [10, 11] },
                { id: 13, predecessors: [4, 5, 7, 9, 12] }, { id: 14, predecessors: [13] }, { id: 15, predecessors: [14] }, { id: 16, predecessors: [15] },
                { id: 17, predecessors: [16] }, { id: 18, predecessors: [14] }, { id: 19, predecessors: [18] }, { id: 20, predecessors: [19] },
                { id: 21, predecessors: [20] }, { id: 22, predecessors: [18] }, { id: 23, predecessors: [22] }, { id: 24, predecessors: [23] },
                { id: 25, predecessors: [19, 22] }, { id: 26, predecessors: [19, 22] }, { id: 27, predecessors: [25, 26] }, { id: 28, predecessors: [27] },
                { id: 29, predecessors: [15] }, { id: 30, predecessors: [17, 21, 24, 27, 29] }, { id: 31, predecessors: [30] },
            ];

            legacyPrecedence.forEach(p => {
                const el = systemState.elements.find(e => e.id === p.id);
                if (el) el.predecessors = p.predecessors;
            });

            // Map Legacy Configs
            systemState.configData = {};
            for (let i = 3; i <= 13; i++) {
                systemState.configData[i] = {};
            }
            configsRaw.forEach(row => {
                for (let i = 3; i <= 13; i++) {
                    const ws = row[`${i}_Workstation`];
                    const el = parseInt(row[`${i}_Element`]);
                    if (ws && !isNaN(el)) {
                        if (!systemState.configData[i][ws]) systemState.configData[i][ws] = [];
                        systemState.configData[i][ws].push(el);
                    }
                }
            });

            calculateAssemblyLineLength();
            calculateCapacityThresholds();
        }

        // Initialize UI State Maps
        state.taskData = new Map(systemState.elements.map(e => [e.id, {
            laborTime: e.baseTime,
            elementTime: e.baseTime,
            description: e.description,
            Super: e.usage.includes(1) ? 1 : 0,
            Ultra: e.usage.includes(2) ? 1 : 0,
            Mega: e.usage.includes(3) ? 1 : 0
        }]));

        state.configData = systemState.configData;
        targetSalesDemand = parseInt(dailyDemandInput.value);

    } catch (error) {
        console.error("Fatal Error: Could not load data.", error);
        demandStatusEl.innerHTML = "Error: Failed to load data.";
    }
}

/**
 * --------------------------------------------------------------------
 * Core Calculation Logic
 * --------------------------------------------------------------------
 */

function calculateMetrics(op, fin, optionsOrSkip = false) {
    fin = fin || {};
    const options = (typeof optionsOrSkip === 'boolean') ? { skipQualityYield: optionsOrSkip } : (optionsOrSkip || {});

    const getVal = (propName, argValue) => {
        if (argValue !== undefined && isFinite(argValue)) return argValue;
        if (fin[propName] !== undefined && isFinite(fin[propName])) return fin[propName];
        return liveState[propName] || 0;
    };

    const finInputs = {
        laborCost: getVal('laborCost'),
        superSell: getVal('superSell'), superCogs: getVal('superCogs'), superRework: getVal('superRework'),
        ultraSell: getVal('ultraSell'), ultraCogs: getVal('ultraCogs'), ultraRework: getVal('ultraRework'),
        megaSell: getVal('megaSell'), megaCogs: getVal('megaCogs'), megaRework: getVal('megaRework'),
    };

    const currentOp = {
        dailyDemand: (op && op.dailyDemand !== undefined) ? op.dailyDemand : liveState.dailyDemand,
        opHours: (op && op.opHours !== undefined) ? op.opHours : liveState.opHours,
        numEmployees: (op && op.numEmployees !== undefined) ? op.numEmployees : liveState.numEmployees
    };

    const wsDetails = calculateWorkstationDetails(currentOp.numEmployees);
    const fullTotalOpMinutes = currentOp.opHours * 60;
    const bottleneckCycleTime = wsDetails.bottleneckTime;
    const productSpacing = wsDetails.fastestTime === Infinity ? 0 : wsDetails.fastestTime * 15;

    const currentLineLength = systemState.assemblyLineLength;

    const calculateThroughput = (productionTarget) => {
        if (productSpacing <= 0 || bottleneckCycleTime <= 0) {
            return { wip: 0, throughputUnitsPerHour: 0, conveyorSpeed: 0, effectiveCycleTime: Infinity, totalUnitsProduced: 0 };
        }

        const bottleneckThroughputTime = (currentLineLength / productSpacing) * bottleneckCycleTime;
        const bottleneckLaunchWindow = fullTotalOpMinutes - bottleneckThroughputTime;

        let physicalMaxUnits = 0;
        if (bottleneckLaunchWindow > 0) {
            physicalMaxUnits = Math.round(bottleneckLaunchWindow / bottleneckCycleTime) + 1;
        } else if (fullTotalOpMinutes >= bottleneckThroughputTime) {
            physicalMaxUnits = 1;
        }

        let effectiveCycleTime;
        let totalUnitsProduced;

        if (productionTarget > physicalMaxUnits) {
            effectiveCycleTime = bottleneckCycleTime;
            totalUnitsProduced = physicalMaxUnits;
        } else {
            const demandIntervals = productionTarget > 1 ? productionTarget - 1 : 0;
            const throughputTimeAsIntervals = currentLineLength / productSpacing;
            const totalIntervals = demandIntervals + throughputTimeAsIntervals;
            if (productionTarget <= 1) effectiveCycleTime = bottleneckCycleTime;
            else effectiveCycleTime = fullTotalOpMinutes / totalIntervals;
            totalUnitsProduced = productionTarget;
        }

        const conveyorSpeed = productSpacing / effectiveCycleTime;
        const wip = currentLineLength / productSpacing;
        const actualThroughputTime = (currentLineLength / productSpacing) * effectiveCycleTime;

        let actualProductionMinutes;
        if (totalUnitsProduced <= 0) actualProductionMinutes = 0;
        else if (totalUnitsProduced === 1) actualProductionMinutes = actualThroughputTime;
        else {
            const demandIntervals = totalUnitsProduced - 1;
            actualProductionMinutes = effectiveCycleTime * (demandIntervals) + actualThroughputTime;
        }

        const throughputUnitsPerHour = actualProductionMinutes > 0 ? (totalUnitsProduced / actualProductionMinutes) * 60 : 0;
        return { wip, throughputUnitsPerHour, conveyorSpeed, effectiveCycleTime, totalUnitsProduced };
    };

    const finalPassResults = calculateThroughput(currentOp.dailyDemand);
    const finalQualityYield = (parseFloat(qualityYieldInput.value) || 100) / 100;
    const totalStress = 1.0 - finalQualityYield;

    const { wip: finalWip, throughputUnitsPerHour, conveyorSpeed, effectiveCycleTime, totalUnitsProduced } = finalPassResults;

    let totalWorkstationCycleTime = 0;
    wsDetails.workstations.forEach(ws => {
        totalWorkstationCycleTime += ws.cycleTime;
        ws.efficiency = bottleneckCycleTime > 0 ? (ws.cycleTime / bottleneckCycleTime) * 100 : 0;
        const idleTimePerCycle = bottleneckCycleTime - ws.cycleTime;
        ws.dailyIdleTime = idleTimePerCycle * totalUnitsProduced;
    });

    const totalAvailableTime = currentOp.numEmployees * fullTotalOpMinutes;
    const totalDailyLaborCost = currentOp.numEmployees * currentOp.opHours * finInputs.laborCost;
    const totalProductiveTime = totalUnitsProduced * totalWorkstationCycleTime;
    const totalIdleTime = Math.max(0, totalAvailableTime - totalProductiveTime);
    const averageEfficiency = totalAvailableTime > 0 ? (totalProductiveTime / totalAvailableTime) * 100 : 0;

    const efficiencies = wsDetails.workstations.map(ws => ws.efficiency);
    const balanceActive = efficiencies.length > 0 ? efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length : 0;
    const balanceDelay = 100 - balanceActive;

    const idleTimesPerCycle = wsDetails.workstations.map(ws => bottleneckCycleTime - ws.cycleTime);
    const idleMean = idleTimesPerCycle.length > 0 ? idleTimesPerCycle.reduce((a, b) => a + b, 0) / idleTimesPerCycle.length : 0;
    const stdDev = Math.sqrt(idleTimesPerCycle.map(x => Math.pow(x - idleMean, 2)).reduce((a, b) => a + b, 0) / (idleTimesPerCycle.length || 1));
    const idleTimeCv = idleMean > 0 ? (stdDev / idleMean) * 100 : 0;

    // Use Dynamic Models for Revenue/Cost calculation
    let totalRevenue = 0;
    let totalCogs = 0;
    let reworkCost = 0;

    systemState.models.forEach((m, idx) => {
        let sell = 0, cogs = 0, rework = 0;
        // Mapping Inputs by index for backward compatibility
        if (idx === 0) { sell = finInputs.superSell; cogs = finInputs.superCogs; rework = finInputs.superRework; }
        else if (idx === 1) { sell = finInputs.ultraSell; cogs = finInputs.ultraCogs; rework = finInputs.ultraRework; }
        else if (idx === 2) { sell = finInputs.megaSell; cogs = finInputs.megaCogs; rework = finInputs.megaRework; }
        // For custom models > 3, use 0 or default

        totalRevenue += totalUnitsProduced * m.ratio * sell;
        totalCogs += totalUnitsProduced * m.ratio * cogs;
        const failedUnits = totalUnitsProduced * m.ratio * totalStress;
        reworkCost += failedUnits * rework;
    });

    const costOfPoorQuality = reworkCost;
    const dailyGrossProfit = totalRevenue - totalCogs - totalDailyLaborCost - costOfPoorQuality;
    const grossProfitMargin = totalRevenue > 0 ? (dailyGrossProfit / totalRevenue) * 100 : 0;

    return {
        wip: finalWip,
        throughputUnitsPerHour: throughputUnitsPerHour,
        conveyorSpeed: conveyorSpeed,
        productSpacing: productSpacing,
        dailyGrossProfit,
        grossProfitMargin,
        costOfPoorQuality,
        meetsDemand: totalUnitsProduced >= currentOp.dailyDemand,
        effectiveCycleTime,
        workstations: wsDetails.workstations,
        averageEfficiency, totalIdleTime, balanceDelay, idleTimeCv,
        throughputUnitsPerDay: totalUnitsProduced,
        qualityYield: finalQualityYield
    };
}

function calculateWorkstationDetails(numEmployees) {
    const config = systemState.configData[numEmployees];
    if (!config || Object.keys(config).length === 0) return { workstations: [], bottleneckTime: 0, fastestTime: Infinity };

    let workstations = [], bottleneckTime = 0, fastestTime = Infinity;

    for (const stationId in config) {
        let totalTime = 0;
        let totalElementTime = 0;

        config[stationId].forEach(taskId => {
            const task = systemState.elements.find(e => e.id === taskId);
            if (task) {
                // Weighted average for "Labor Time"
                let weightedTime = 0;
                let totalRatio = 0;
                systemState.models.forEach(model => {
                    if (task.usage.includes(model.id)) {
                        weightedTime += task.baseTime * model.ratio;
                        totalRatio += model.ratio;
                    }
                });
                const effectiveTime = totalRatio > 0 ? weightedTime : task.baseTime;
                totalTime += effectiveTime;
                totalElementTime += task.baseTime;
            }
        });

        const stationLength = totalElementTime * 15;
        workstations.push({ id: stationId, cycleTime: totalTime, stationLength: stationLength });

        if (totalTime > bottleneckTime) bottleneckTime = totalTime;
        if (totalTime < fastestTime && totalTime > 0) fastestTime = totalTime;
    }

    return { workstations, bottleneckTime, fastestTime };
}

function getRequiredHours(demand, numEmployees) {
    const { bottleneckTime, fastestTime } = calculateWorkstationDetails(numEmployees);
    if (bottleneckTime <= 0 || !isFinite(fastestTime) || fastestTime <= 0) return 24;
    const productSpacing = fastestTime * 15;
    const throughputTime = (systemState.assemblyLineLength / productSpacing) * bottleneckTime;
    const totalRequiredMinutes = (demand > 1 ? (demand - 1) * bottleneckTime : 0) + throughputTime;
    return totalRequiredMinutes / 60;
}

function calculateMaxDemand(hours, numEmployees) {
    const { bottleneckTime, fastestTime } = calculateWorkstationDetails(numEmployees);
    if (bottleneckTime <= 0 || !isFinite(fastestTime) || fastestTime <= 0) return 0;

    const productSpacing = fastestTime * 15;
    const throughputTimeMinutes = (systemState.assemblyLineLength / productSpacing) * bottleneckTime;
    const totalOpMinutes = Math.floor(hours * 4) * 15;
    if (totalOpMinutes < (throughputTimeMinutes - 1e-9)) return 0;

    const launchWindowMinutes = totalOpMinutes - throughputTimeMinutes;
    return Math.floor((launchWindowMinutes / bottleneckTime) + 1e-9) + 1;
}

function findBestEmployeeFitForDemand(demand, hours, currentEmployees) {
    const requiredTakt = (hours * 60) / demand;
    if (calculateWorkstationDetails(currentEmployees).bottleneckTime <= requiredTakt) return currentEmployees;

    const availableCounts = Object.keys(systemState.configData).map(Number).sort((a, b) => a - b);
    for (let c of availableCounts) {
        if (calculateWorkstationDetails(c).bottleneckTime <= requiredTakt) return c;
    }
    return availableCounts[availableCounts.length - 1] || 13;
}

function doesElementBuildModel(elementId, modelId) {
    const task = systemState.elements.find(e => e.id === elementId);
    if (!task) return false;
    return task.usage.includes(modelId);
}

// UI Updates
function updateUI(options = {}) {
    employeeCountDisplay.textContent = numEmployeesInput.value;
    if (qualityStDevPercentageDisplay) {
        qualityStDevPercentageDisplay.textContent = (parseFloat(qualityStDevPercentageInput.value) * 100).toFixed(1);
    }

    renderWorkstationSidebar(parseInt(numEmployeesInput.value));
    setupDragAndDrop();

    if (!options.skipPrecedence) {
        invalidPrecedenceNodes = validatePrecedence();
    }

    if (invalidPrecedenceNodes.size > 0) {
        demandStatusEl.textContent = "Fails to Meet Precedence";
        demandStatusEl.className = "status failure";
    } else {
        const results = calculateMetrics();
        if (results) {
            animateValue(wipEl, results.wip, 800, val => val.toFixed(1) + " units");
            animateValue(throughputEl, results.throughputUnitsPerHour, 800, val => `${val.toFixed(1)}/hr`);
            animateValue(conveyorSpeedEl, results.conveyorSpeed, 800, val => `${val.toFixed(2)} ft/min`);
            animateValue(productSpacingEl, results.productSpacing, 800, val => `${val.toFixed(2)} ft`);
            animateValue(grossProfitEl, results.dailyGrossProfit, 800, val => val.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }));
            animateValue(profitMarginEl, results.grossProfitMargin, 800, val => `${val.toFixed(1)}%`);
            animateValue(avgEfficiencyEl, results.averageEfficiency, 800, val => `${val.toFixed(1)}%`);
            animateValue(totalIdleTimeEl, results.totalIdleTime / 60, 800, val => `${val.toFixed(2)} hrs`);
            animateValue(balanceDelayEl, results.balanceDelay, 800, val => `${val.toFixed(1)}%`);
            animateValue(idleTimeCvEl, results.idleTimeCv, 800, val => `${val.toFixed(1)}%`);
            animateValue(qualityYieldEl, results.qualityYield * 100, 800, val => `${val.toFixed(1)}%`);
            animateValue(copqEl, results.costOfPoorQuality, 800, val => val.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }));

            const idleHoursTotal = (results.totalIdleTime || 0) / 60;
            const idleHoursPerEmployee = (liveState.numEmployees > 0) ? idleHoursTotal / liveState.numEmployees : idleHoursTotal;

            if (results.meetsDemand && idleHoursPerEmployee > 12) {
                demandStatusEl.textContent = "Too Much Idle Time";
                demandStatusEl.className = "status failure";
            } else {
                demandStatusEl.textContent = results.meetsDemand ? "Meets Demand" : "Fails to Meet Demand";
                demandStatusEl.className = results.meetsDemand ? "status success" : "status failure";
            }
        }
    }

    renderActiveTab();
}

function renderWorkstationSidebar(numEmployees) {
    workstationList.innerHTML = '';
    const config = systemState.configData[numEmployees];
    if (!config || Object.keys(config).length === 0) return;

    const sortedStationIds = Object.keys(config).sort((a, b) => parseInt(a) - parseInt(b));
    const numWorkstations = sortedStationIds.length;

    let maxElementTime = 0;
    systemState.elements.forEach(t => {
        if (t.baseTime > maxElementTime) maxElementTime = t.baseTime;
    });
    if (maxElementTime === 0) return;

    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

    sortedStationIds.forEach((stationId, stationIndex) => {
        const elementsInStation = config[stationId];
        const elementColorScale = generateElementColorScale(stationIndex, numWorkstations, elementsInStation.length);
        const workstationDiv = document.createElement('div');
        workstationDiv.className = 'workstation';

        const title = document.createElement('div');
        title.className = 'workstation-title';
        title.textContent = `Workstation ${stationId}`;
        workstationDiv.appendChild(title);

        const elementsContainer = document.createElement('div');
        elementsContainer.className = 'workstation-elements';
        elementsInStation.forEach((taskId, elementIndex) => {
            const task = systemState.elements.find(e => e.id === taskId);
            if (task) {
                const elementColor = elementColorScale(elementIndex);
                const elementRow = document.createElement('div');
                elementRow.className = 'element-row';
                elementRow.dataset.taskId = taskId;

                const barWrapper = document.createElement('div');
                barWrapper.className = 'element-bar-wrapper';

                const elementTimeBar = document.createElement('div');
                elementTimeBar.className = 'element-time-bar';
                const elementBarWidth = (task.baseTime / maxElementTime) * 80;
                elementTimeBar.style.width = `${elementBarWidth}%`;
                elementTimeBar.style.backgroundColor = accentColor;
                elementTimeBar.style.border = `2px solid ${accentColor}`;
                elementTimeBar.style.borderRadius = '4px';

                let weightedTime = 0;
                let totalRatio = 0;
                systemState.models.forEach(model => {
                    if (task.usage.includes(model.id)) {
                        weightedTime += task.baseTime * model.ratio;
                        totalRatio += model.ratio;
                    }
                });
                const effectiveTime = totalRatio > 0 ? weightedTime : task.baseTime;

                const laborTimeBar = document.createElement('div');
                laborTimeBar.className = 'labor-time-bar';
                laborTimeBar.style.backgroundColor = elementColor;
                const laborBarRatio = task.baseTime > 0 ? (effectiveTime / task.baseTime) : 0;
                laborTimeBar.style.transform = `scaleX(${laborBarRatio})`;

                const label = document.createElement('span');
                label.className = 'labor-bar-text';
                label.textContent = taskId;
                elementTimeBar.appendChild(label);
                elementTimeBar.appendChild(laborTimeBar);
                barWrapper.appendChild(elementTimeBar);
                elementRow.appendChild(barWrapper);
                elementRow.dataset.workstationId = stationId;
                elementsContainer.appendChild(elementRow);
            }
        });
        workstationDiv.appendChild(elementsContainer);
        workstationList.appendChild(workstationDiv);
    });
}

function updateWorkstationOrder() {
    const numEmployees = parseInt(numEmployeesInput.value);
    const newConfig = {};
    const workstationDivs = document.querySelectorAll('#workstation-list .workstation');

    workstationDivs.forEach(workstationDiv => {
        const title = workstationDiv.querySelector('.workstation-title')?.textContent || '';
        const stationMatch = title.match(/Workstation (\d+)/);

        if (stationMatch) {
            const stationId = stationMatch[1];
            const elements = [];
            const elementsContainer = workstationDiv.querySelector('.workstation-elements');
            if (elementsContainer) {
                elementsContainer.querySelectorAll('.element-row').forEach(elRow => {
                    const taskId = parseInt(elRow.dataset.taskId);
                    if (!isNaN(taskId)) elements.push(taskId);
                });
            }
            newConfig[stationId] = elements;
        }
    });

    systemState.configData[numEmployees] = newConfig;
    state.configData = systemState.configData;
    updateUI();
}

function validatePrecedence() {
    const seenTasks = new Set();
    const allElementRows = document.querySelectorAll('.element-row');
    const invalidNodes = new Set();
    const elementMap = new Map(systemState.elements.map(e => [e.id, e]));

    allElementRows.forEach(row => {
        const taskId = parseInt(row.dataset.taskId);
        const task = elementMap.get(taskId);
        let isTaskValid = true;

        if (task && task.predecessors) {
            for (const pId of task.predecessors) {
                if (!seenTasks.has(pId)) {
                    isTaskValid = false;
                    break;
                }
            }
        }

        if (!isTaskValid) {
            row.classList.add('precedence-error');
            invalidNodes.add(taskId);
        } else {
            row.classList.remove('precedence-error');
        }
        seenTasks.add(taskId);
    });

    return invalidNodes;
}

function generateElementColorScale(workstationIndex, numWorkstations, numElements) {
    const schemeColors = [
        getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
        getComputedStyle(document.documentElement).getPropertyValue('--secondary1').trim(),
        getComputedStyle(document.documentElement).getPropertyValue('--secondary2').trim(),
    ];
    const baseColor = d3.hcl(schemeColors[workstationIndex % schemeColors.length]);
    const startColor = baseColor.copy();
    startColor.l += 15;
    const endColor = baseColor.copy();
    endColor.l -= 15;
    return d3.scaleLinear()
        .domain([0, numElements > 1 ? numElements - 1 : 1])
        .range([startColor.toString(), endColor.toString()])
        .interpolate(d3.interpolateHcl);
}

function setInputValue(input, value, decimals) {
    if (!input) return;
    let formattedValue = String(value);
    if (decimals !== undefined) formattedValue = Number(value).toFixed(decimals);
    input.value = formattedValue;
    input.dataset.committedValue = formattedValue;
    if (input.id in liveState) liveState[input.id] = parseFloat(formattedValue);
}

function syncLiveState() {
    const update = (id, el) => { if (el) liveState[id] = parseFloat(el.value); };
    update('dailyDemand', dailyDemandInput);
    update('opHours', opHoursInput);
    update('numEmployees', numEmployeesInput);
    update('laborCost', laborCostInput);
    update('superSell', superSellInput);
    update('superCogs', superCogsInput);
    update('superRework', superReworkInput);
    update('ultraSell', ultraSellInput);
    update('ultraCogs', ultraCogsInput);
    update('ultraRework', ultraReworkInput);
    update('megaSell', megaSellInput);
    update('megaCogs', megaCogsInput);
    update('megaRework', megaReworkInput);
    update('qualityYieldInput', qualityYieldInput);
    update('qualityStDevPercentage', qualityStDevPercentageInput);
}

function handleInputChange(driverId, context = {}) {
    if (isRecalculating) return;
    isRecalculating = true;
    const skipAutoAdjust = context && context.skipAutoAdjust;

    if (['laborCost', 'superSell', 'superCogs', 'qualityYieldInput'].some(x => driverId === x)) {
        if (driverId === 'qualityYieldInput') qualityYieldInput.dataset.userModified = "true";
        if (driverId === 'laborCost' && typeof LocationTab !== 'undefined') {
            LocationTab.updateLocalWageStress(parseFloat(laborCostInput.value));
        }
    }

    try {
        let opHours = parseFloat(opHoursInput.value) || 1;
        let numEmployees = parseInt(numEmployeesInput.value);
        let productionTarget = parseInt(dailyDemandInput.value) || 1;

        if (driverId === 'numEmployees') {
            systemState.configData[numEmployees] = JSON.parse(JSON.stringify(originalConfigData[numEmployees] || systemState.configData[numEmployees]));
            invalidPrecedenceNodes.clear();
        }

        if (['dailyDemand', 'opHours', 'numEmployees'].includes(driverId) && autoAdjustEnabled && !skipAutoAdjust) {
            switch (driverId) {
                case 'dailyDemand':
                    numEmployees = findBestEmployeeFitForDemand(productionTarget, opHours, numEmployees);
                    opHours = Math.min(24, Math.ceil(getRequiredHours(productionTarget, numEmployees) / 0.25) * 0.25);
                    const maxPhysDemand = calculateMaxDemand(opHours, numEmployees);
                    if (productionTarget > maxPhysDemand) {
                        productionTarget = maxPhysDemand;
                        setInputValue(dailyDemandInput, productionTarget);
                    }
                    break;
                case 'numEmployees':
                    opHours = Math.min(24, Math.ceil(getRequiredHours(productionTarget, numEmployees) / 0.25) * 0.25);
                    const maxPhysEmp = calculateMaxDemand(opHours, numEmployees);
                    if (productionTarget > maxPhysEmp) {
                        productionTarget = maxPhysEmp;
                        setInputValue(dailyDemandInput, productionTarget);
                    }
                    break;
                case 'opHours':
                    const maxPhysHrs = calculateMaxDemand(opHours, numEmployees);
                    if (productionTarget > maxPhysHrs) {
                        productionTarget = maxPhysHrs;
                        setInputValue(dailyDemandInput, productionTarget);
                    }
                    break;
            }
            setInputValue(opHoursInput, opHours, 2);
            setInputValue(numEmployeesInput, numEmployees);
        }
        updateUI();
    } finally {
        isRecalculating = false;
    }
}

function animateValue(element, end, duration = 1000, formatter = (val) => val.toFixed(1)) {
    if (!element || typeof end !== 'number' || !isFinite(end)) return;
    let start = element._previousNumericValue || 0;
    element._previousNumericValue = end;
    if (duration <= 0) { element.textContent = formatter(end); return; }

    const startTime = performance.now();
    const range = end - start;
    function step(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 4);
        element.textContent = formatter(start + (range * eased));
        if (progress < 1) requestAnimationFrame(step);
        else element.textContent = formatter(end);
    }
    requestAnimationFrame(step);
}

function createTooltip(className) {
    let tooltip = d3.select(`body > .d3-tooltip.${className}`);
    if (tooltip.empty()) {
        tooltip = d3.select("body").append("div")
            .attr("class", `d3-tooltip ${className || ''}`)
            .style("opacity", 0).style("position", "absolute");
    }
    return tooltip;
}

function positionTooltip(tooltip, event, xOffset = 15, yOffset = 0) {
    const node = tooltip.node();
    const width = node ? node.offsetWidth : 200;
    let left = event.pageX + xOffset;
    if (event.pageX > window.innerWidth * 0.75) left = event.pageX - width - xOffset;
    tooltip.style('left', `${left}px`).style('top', `${event.pageY + yOffset}px`);
}

function attachCommitBehavior(inputs, onCommit) {
    inputs.forEach(input => {
        input.addEventListener('change', () => { onCommit(input.id, input.value); });
    });
}

function renderActiveTab() {
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'precedence') drawPrecedenceChart(invalidPrecedenceNodes);
    else if (activeTab === 'efficiency') EfficiencyTab.draw();
    else if (activeTab === 'schedule') ScheduleTab.draw();
    else if (activeTab === 'layout') LayoutTab.draw();
    else if (activeTab === 'profit') ProfitTab.draw();
    else if (activeTab === 'investment') InvestmentTab.draw();
    else if (activeTab === 'location') LocationTab.draw();
    else if (activeTab === 'overview') drawOverviewPanel();
    setWorkstationListHeight();
}

async function drawOverviewPanel() {
    const svg = d3.select("#overview-panel");
    svg.selectAll("*").remove();
    const fo = svg.append("foreignObject")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", "100%")
        .attr("height", "100%");
    const container = fo.append("xhtml:div")
        .attr("class", "overview-container");

    try {
        const response = await fetch('Pages/overview.html');
        if (!response.ok) throw new Error(`Failed to load HTML: ${response.statusText}`);
        let html = await response.text();

        // Inject dynamic values (Legacy support)
        const replacements = {
            'overview-num-employees': document.getElementById('numEmployees')?.value || '8',
            'overview-daily-demand': document.getElementById('dailyDemand')?.value || '180'
        };

        for (const [id, value] of Object.entries(replacements)) {
            const regex = new RegExp(`(<span id="${id}">)(.*?)(<\\/span>)`);
            html = html.replace(regex, `$1${value}$3`);
        }

        container.html(html);

        // --- NEW: Populate the Embedded Config Form ---
        // We wait a tick to ensure DOM is ready inside the foreignObject
        setTimeout(() => {
            if (typeof window.populateConfigForm === 'function') {
                window.populateConfigForm();
            }
        }, 50);

    } catch (error) {
        console.error("Could not render Overview panel:", error);
        container.html(`<p style="padding: 2rem; text-align: center;">Error: Could not load overview content.</p>`);
    }
}

// ... [Rest of script.js remains the same] ...

function setWorkstationListHeight() {
    const header = document.querySelector('.main-header');
    const container = document.getElementById('svg-container');
    if (header && container && workstationList) {
        workstationList.style.maxHeight = `${container.clientHeight - 60}px`;
    }
}

// Setup Calls
function setupEventListeners() {
    const inputs = [
        dailyDemandInput, opHoursInput, numEmployeesInput, laborCostInput,
        superSellInput, superCogsInput, superReworkInput,
        ultraSellInput, ultraCogsInput, ultraReworkInput,
        megaSellInput, megaCogsInput, megaReworkInput,
        qualityYieldInput, qualityStDevPercentageInput
    ];
    attachCommitBehavior(inputs, (id) => handleInputChange(id));
}

function setupUIEventListeners() {
    leftToggle.addEventListener('click', () => document.getElementById('left-sidebar').classList.toggle('collapsed'));
    rightToggle.addEventListener('click', () => document.getElementById('right-sidebar').classList.toggle('collapsed'));

    tabs.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn')) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const target = e.target.dataset.tab;
            visPanels.forEach(p => p.style.display = (p.id === `${target}-panel` ? 'block' : 'none'));
            renderActiveTab();
        }
    });
}

function enableMiddleDragNumberInput(input, step = 1, sensitivity = 0.1) {
    let isDragging = false;
    let startY = 0;
    let startValue = 0;

    const getConstraints = () => {
        const min = input.hasAttribute('min') ? parseFloat(input.min) : -Infinity;
        const max = input.hasAttribute('max') ? parseFloat(input.max) : Infinity;
        const stepValue = input.id === 'opHours' ? 0.25 : (parseFloat(input.step) || 1);
        return { min, max, step: stepValue };
    };

    const formatValue = (val) => {
        if (Math.abs(val % 1) < 1e-9) return val.toFixed(0);
        return parseFloat(val.toFixed(2));
    };

    input.addEventListener("pointerdown", (e) => {
        if (e.pointerType === 'mouse' && e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
            isDragging = true;
            startY = e.clientY;
            startValue = parseFloat(input.value || 0);

            const onPointerMove = (ev) => {
                if (!isDragging) return;
                const deltaY = startY - ev.clientY;
                const constraints = getConstraints();
                const deltaSteps = Math.round(deltaY * sensitivity);
                let newVal = startValue + (deltaSteps * constraints.step);
                newVal = Math.max(constraints.min, Math.min(constraints.max, newVal));
                input.value = formatValue(newVal);
                input.dispatchEvent(new Event("input", { bubbles: true }));
            };

            const onPointerUp = () => {
                isDragging = false;
                document.removeEventListener("pointermove", onPointerMove);
                document.removeEventListener("pointerup", onPointerUp);
            };

            document.addEventListener("pointermove", onPointerMove);
            document.addEventListener("pointerup", onPointerUp);
        }
    });

    input.addEventListener("wheel", (e) => {
        if (document.activeElement === input) {
            e.preventDefault();
            const constraints = getConstraints();
            const direction = e.deltaY > 0 ? -1 : 1;
            let currentValue = parseFloat(input.value || 0);
            let newVal = currentValue + (direction * constraints.step);
            newVal = Math.max(constraints.min, Math.min(constraints.max, newVal));
            input.value = formatValue(newVal);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }
    });
}

function setupDragAndDrop() {
    sortableInstances.forEach(instance => instance.destroy());
    sortableInstances = [];
    const workstationElements = document.querySelectorAll('.workstation-elements');
    workstationElements.forEach(el => {
        const instance = new Sortable(el, {
            group: 'shared',
            animation: 150,
            onEnd: function (evt) {
                setTimeout(() => updateWorkstationOrder(), 0);
            }
        });
        sortableInstances.push(instance);
    });
}

function handleVisibilityChange() {
    if (document.hidden) {
        if (animationState.schedule.isRunning) animationState.schedule.isPaused = true;
        if (animationState.layout.isRunning) animationState.layout.isPaused = true;
    } else {
        if (animationState.schedule.isPaused && !animationState.schedule.isManuallyPaused) {
            animationState.schedule.isPaused = false;
            animationState.schedule.lastFrameTime = performance.now();
        }
        if (animationState.layout.isPaused && !animationState.layout.isManuallyPaused) {
            animationState.layout.isPaused = false;
            animationState.layout.lastFrameTime = performance.now();
        }
    }
}

function setupVisibilityListener() {
    document.addEventListener('visibilitychange', handleVisibilityChange, false);
}

function restoreActiveTab() {
    let targetTab = sessionStorage.getItem("activeTab") || "overview";
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    const btn = document.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
    if (btn) btn.classList.add("active");
    visPanels.forEach(panel => {
        panel.style.display = panel.id === `${targetTab}-panel` ? "block" : "none";
    });
}

function wireRightSidebarTooltips() {
    const tooltip = createTooltip('right-sidebar-tooltip');
    const container = document.getElementById('right-sidebar');
    if (!container) return;
    const tips = {
        'dailyDemand': 'Number of units required per day.',
        'opHours': 'Hours the line runs per day.',
        'numEmployees': 'Total workers on the line.',
        'laborCost': 'Hourly cost per worker.',
        'qualityYieldInput': 'Percentage of units that pass inspection first time.',
        'wip': 'Average units currently on the line.',
        'throughput': 'Actual output rate per hour.',
        'copq': 'Cost of Poor Quality (Rework costs).',
        'grossProfit': 'Revenue - (COGS + Labor + Rework).',
        'profitMargin': 'Gross Profit / Revenue.'
    };
    Object.keys(tips).forEach(id => {
        const el = document.getElementById(id);
        const target = el ? (el.previousElementSibling || el) : null;
        if (target) {
            target.style.cursor = "help";
            target.addEventListener('mouseover', (e) => {
                tooltip.html(`<div class="tooltip-row">${tips[id]}</div>`).style('opacity', 1);
                positionTooltip(tooltip, e, 15, -28);
            });
            target.addEventListener('mousemove', (e) => positionTooltip(tooltip, e, 15, -28));
            target.addEventListener('mouseout', () => tooltip.style('opacity', 0));
        }
    });
}

function getEstimatedYield() {
    if (qualityYieldInput && qualityYieldInput.dataset.userModified === "true") {
        return parseFloat(qualityYieldInput.value) / 100;
    }
    if (window.lastQualityBreakdown && window.lastQualityBreakdown.totalStress) {
        return 1.0 - window.lastQualityBreakdown.totalStress;
    }
    return 0.95;
}

function updateFinancialSidebar({ npv, irr, payback } = {}) {
    const npvEl = document.getElementById('npvMetric');
    const irrEl = document.getElementById('irrMetric');
    const paybackEl = document.getElementById('paybackMetric');
    if (npvEl) animateValue(npvEl, npv || 0, 800, val => val.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
    if (irrEl) irrEl.textContent = isFinite(irr) ? `${(irr * 100).toFixed(1)}%` : 'No Return';
    if (paybackEl) paybackEl.textContent = isFinite(payback) ? `${(payback * 365).toFixed(0)} Days` : 'Net Loss';
}

function roundUpToQuarter(v) { return Math.ceil(v * 4) / 4; }
function updateCompareBtn() { }
function injectCustomStyles() { } // No-op as styles are in CSS

/**
 * --------------------------------------------------------------------
 * Configuration Modal Logic (UI Handlers)
 * --------------------------------------------------------------------
 */

/**
 * Loads the HTML content for the Configuration Modal and injects it into the DOM.
 */
async function loadConfigModal() {
    try {
        const response = await fetch('Pages/config.html');
        if (!response.ok) throw new Error("Failed to load config.html");
        const html = await response.text();

        const container = document.createElement('div');
        container.innerHTML = html;
        const modal = container.firstElementChild;
        document.body.appendChild(modal);

        document.getElementById('config-modal-close').addEventListener('click', () => {
            document.getElementById('config-modal').style.display = 'none';
        });
        document.getElementById('config-modal-cancel').addEventListener('click', () => {
            document.getElementById('config-modal').style.display = 'none';
        });

    } catch (e) {
        console.error("Error loading configuration modal:", e);
    }
}

/**
 * Global function to switch tabs within the Configuration Modal.
 */
window.openConfigTab = function (tabId) {
    document.querySelectorAll('.config-tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.modal-tab-btn').forEach(el => el.classList.remove('active'));

    const target = document.getElementById(tabId);
    if (target) target.classList.add('active');

    const btns = document.querySelectorAll('.modal-tab-btn');
    if (btns.length >= 2) {
        if (tabId === 'tab-models') btns[0].classList.add('active');
        else btns[1].classList.add('active');
    }
};

/**
 * Adds a row to the Models table.
 */
window.addModelRow = function (data = {}) {
    const tbody = document.querySelector('#models-table tbody');
    const tr = document.createElement('tr');

    const id = data.id || (tbody.children.length + 1);
    const name = data.name || `Model ${id}`;
    const ratio = data.ratio !== undefined ? data.ratio : 0.0;
    const len = data.length || 0;
    const wid = data.width || 0;
    const hgt = data.height || 0;
    const wgt = data.weight || 0;

    tr.innerHTML = `
        <td>${id}</td>
        <td><input type="text" class="model-name" value="${name}"></td>
        <td><input type="number" class="model-ratio" value="${ratio}" step="0.05" min="0" max="1"></td>
        <td><input type="number" class="model-len" value="${len}" min="0"></td>
        <td><input type="number" class="model-wid" value="${wid}" min="0"></td>
        <td><input type="number" class="model-hgt" value="${hgt}" min="0"></td>
        <td><input type="number" class="model-wgt" value="${wgt}" min="0"></td>
        <td><button class="btn-secondary" style="padding: 2px 8px;" onclick="removeConfigRow(this)">X</button></td>
    `;
    tbody.appendChild(tr);
    updateElementTableColumns();
};

/**
 * Adds a row to the Elements table.
 */
window.addElementRow = function (data = {}) {
    const tbody = document.querySelector('#elements-table tbody');
    const tr = document.createElement('tr');

    const id = data.id || (tbody.children.length + 1);
    const desc = data.description || "New Task";
    const time = data.baseTime !== undefined ? data.baseTime : 0;
    const preds = data.predecessors ? data.predecessors.join(',') : "";

    tr.innerHTML = `
        <td><input type="number" class="elem-id" value="${id}" style="width: 50px;"></td>
        <td><input type="text" class="elem-desc" value="${desc}"></td>
        <td><input type="number" class="elem-time" value="${time}" step="0.1" min="0"></td>
        <td><input type="text" class="elem-preds" value="${preds}" placeholder="1,2"></td>
        <td><button class="btn-secondary" style="padding: 2px 8px;" onclick="removeConfigRow(this)">X</button></td>
    `;

    const actionCell = tr.lastElementChild;
    const models = getModelsFromDom();

    models.forEach(m => {
        const td = document.createElement('td');
        const isChecked = data.usage ? data.usage.includes(m.id) : true;
        td.innerHTML = `<input type="checkbox" class="elem-usage" data-model-id="${m.id}" ${isChecked ? 'checked' : ''}>`;
        tr.insertBefore(td, actionCell);
    });

    tbody.appendChild(tr);
};

window.removeConfigRow = function (btn) {
    const row = btn.closest('tr');
    const isModelRow = row.closest('#models-table');
    row.remove();
    if (isModelRow) updateElementTableColumns();
};

function getModelsFromDom() {
    const rows = document.querySelectorAll('#models-table tbody tr');
    return Array.from(rows).map((tr, index) => {
        return {
            id: index + 1,
            name: tr.querySelector('.model-name').value
        };
    });
}

function updateElementTableColumns() {
    const models = getModelsFromDom();
    const elemTable = document.getElementById('elements-table');
    const headerRow = elemTable.querySelector('thead tr');
    const actionHeader = document.getElementById('element-actions-header');

    while (headerRow.children.length > 5) {
        headerRow.removeChild(headerRow.children[4]);
    }

    models.forEach(m => {
        const th = document.createElement('th');
        th.textContent = m.name;
        headerRow.insertBefore(th, actionHeader);
    });

    const tbody = elemTable.querySelector('tbody');
    Array.from(tbody.children).forEach(tr => {
        const actionCell = tr.lastElementChild;
        const existingChecks = {};
        tr.querySelectorAll('.elem-usage').forEach((chk, i) => {
            existingChecks[i] = chk.checked;
        });

        while (tr.children.length > 5) {
            tr.removeChild(tr.children[4]);
        }

        models.forEach((m, i) => {
            const td = document.createElement('td');
            const wasChecked = existingChecks[i] !== undefined ? existingChecks[i] : true;
            td.innerHTML = `<input type="checkbox" class="elem-usage" data-model-id="${m.id}" ${wasChecked ? 'checked' : ''}>`;
            tr.insertBefore(td, actionCell);
        });
    });
}

window.populateConfigForm = function () {
    document.querySelector('#models-table tbody').innerHTML = '';
    document.querySelector('#elements-table tbody').innerHTML = '';

    if (systemState.models && systemState.models.length > 0) {
        systemState.models.forEach(m => window.addModelRow(m));
    } else {
        window.addModelRow();
    }

    if (systemState.elements && systemState.elements.length > 0) {
        systemState.elements.forEach(e => window.addElementRow(e));
    } else {
        window.addElementRow();
    }
};

window.saveAndOptimizeConfig = function () {
    const modelRows = document.querySelectorAll('#models-table tbody tr');
    const models = Array.from(modelRows).map((tr, i) => ({
        id: i + 1,
        name: tr.querySelector('.model-name').value || `Model ${i + 1}`,
        ratio: parseFloat(tr.querySelector('.model-ratio').value) || 0,
        length: parseFloat(tr.querySelector('.model-len').value) || 0,
        width: parseFloat(tr.querySelector('.model-wid').value) || 0,
        height: parseFloat(tr.querySelector('.model-hgt').value) || 0,
        weight: parseFloat(tr.querySelector('.model-wgt').value) || 0
    }));

    const elemRows = document.querySelectorAll('#elements-table tbody tr');
    const elements = Array.from(elemRows).map(tr => {
        const usage = [];
        tr.querySelectorAll('.elem-usage').forEach(chk => {
            if (chk.checked) usage.push(parseInt(chk.dataset.modelId));
        });

        const predStr = tr.querySelector('.elem-preds').value.trim();
        const predecessors = predStr ? predStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : [];

        return {
            id: parseInt(tr.querySelector('.elem-id').value),
            description: tr.querySelector('.elem-desc').value,
            baseTime: parseFloat(tr.querySelector('.elem-time').value) || 0,
            predecessors: predecessors,
            usage: usage
        };
    });

    if (models.length === 0 || elements.length === 0) {
        alert("Configuration must have at least one model and one element.");
        return;
    }

    const totalRatio = models.reduce((sum, m) => sum + m.ratio, 0);
    if (Math.abs(totalRatio - 1.0) > 0.05) {
        if (!confirm(`Total Build Ratio is ${(totalRatio * 100).toFixed(0)}%. It is recommended to sum to 100%. Continue?`)) return;
    }

    runSystemOptimization(models, elements).catch(err => {
        alert("Optimization failed: " + err);
        console.error(err);
    });
};

/**
 * Triggers the MILP optimization process.
 * Called by the ConfigManager (UI) when the user submits the new table.
 */
function runSystemOptimization(models, elements) {
    return new Promise((resolve, reject) => {
        // Update state definition immediately
        systemState.models = models;
        systemState.elements = elements;

        const statusEl = document.getElementById('demandStatus');
        if (statusEl) {
            statusEl.textContent = "Optimizing Line Balance...";
            statusEl.className = "status";
        }

        const solverWorker = new Worker('optimization.worker.js');

        solverWorker.postMessage({
            type: 'SOLVE_SALBP',
            elements: elements,
            models: models
        });

        solverWorker.onmessage = function (e) {
            const { success, configData, error } = e.data;

            if (success) {
                // 1. Update Configuration State
                systemState.configData = configData;
                state.configData = configData;

                // 2. Refresh Task Data Map for UI Lookups
                state.taskData = new Map(systemState.elements.map(e => [e.id, {
                    laborTime: e.baseTime,
                    elementTime: e.baseTime,
                    description: e.description,
                    Super: e.usage.includes(1) ? 1 : 0,
                    Ultra: e.usage.includes(2) ? 1 : 0,
                    Mega: e.usage.includes(3) ? 1 : 0
                }]));

                // 3. DYNAMICALLY ADJUST EMPLOYEE SLIDER
                // Get the valid station counts returned by the solver
                const validCounts = Object.keys(configData).map(Number).sort((a, b) => a - b);

                if (validCounts.length > 0) {
                    const minStations = validCounts[0];
                    const maxStations = validCounts[validCounts.length - 1];

                    // Update Input Limits
                    numEmployeesInput.min = minStations;
                    numEmployeesInput.max = maxStations;

                    // Validate Current Value
                    let currentVal = parseInt(numEmployeesInput.value);

                    // If current value is invalid or out of range, snap to the nearest valid
                    if (currentVal < minStations || currentVal > maxStations || !configData[currentVal]) {
                        // Default to the minimum stations (most efficient) if current is out of bounds
                        currentVal = Math.max(minStations, Math.min(maxStations, currentVal));
                        // Force update the input and the live state
                        setInputValue(numEmployeesInput, currentVal);
                        // Update the text display next to the slider
                        if (employeeCountDisplay) employeeCountDisplay.textContent = currentVal;
                    }
                }

                // 4. Recalculate Derived Constraints
                calculateCapacityThresholds();
                calculateAssemblyLineLength();

                // 5. Persist and Update UI
                sessionStorage.setItem("customSystemConfig", JSON.stringify(systemState));

                updateUI({ forceRedraw: true });

                if (statusEl) {
                    statusEl.textContent = "Optimization Complete";
                    statusEl.className = "status success";
                }

                document.getElementById('config-modal').style.display = 'none';

                resolve(systemState);
            } else {
                console.error("Optimization Failed", error);
                if (statusEl) {
                    statusEl.textContent = "Optimization Failed";
                    statusEl.className = "status failure";
                }
                reject(error);
            }
            solverWorker.terminate();
        };
    });
}

/**
 * Generates a mixed-model production sequence (MSSA).
 * Uses systemState.models instead of static BUILD_RATIOS.
 */
function generateProductionQueue(dailyDemand) {
    const productionQueue = [];
    const models = systemState.models;

    // Calculate demand per model based on ratio
    let modelDemands = models.map(m => Math.round(m.ratio * dailyDemand));

    // Adjust rounding errors to match total dailyDemand
    const currentSum = modelDemands.reduce((a, b) => a + b, 0);
    if (currentSum < dailyDemand) {
        modelDemands[0] += (dailyDemand - currentSum);
    } else if (currentSum > dailyDemand) {
        modelDemands[0] -= (currentSum - dailyDemand);
    }

    // Heijunka / Smoothing Logic (Model-Mix Sequencing Algorithm)
    const wModel = modelDemands.map(d => (d > 0 ? dailyDemand / d : Infinity));
    let aModel = wModel.map(w => w / 2);

    for (let j = 0; j < dailyDemand; j++) {
        let minIndex = -1;
        let minValue = Infinity;

        for (let k = 0; k < aModel.length; k++) {
            if (modelDemands[k] > 0 && aModel[k] < minValue) {
                minValue = aModel[k];
                minIndex = k;
            }
        }

        if (minIndex === -1) break;

        // Push Model ID
        productionQueue.push(models[minIndex].id);
        aModel[minIndex] += wModel[minIndex];
        modelDemands[minIndex]--;
    }
    return productionQueue;
}

/**
 * Runs the discrete event simulation for the Schedule Tab (Gantt Chart).
 * Uses systemState for config and element data.
 */
function runGanttSimulation() {
    const numEmployees = parseInt(numEmployeesInput.value);
    const dailyDemand = parseInt(dailyDemandInput.value);

    // Get config for current employee count
    const config = systemState.configData[numEmployees];

    if (!config || Object.keys(config).length === 0 || invalidPrecedenceNodes.size > 0) {
        return { tasks: [] };
    }

    const productionQueue = generateProductionQueue(dailyDemand);

    // We need metrics for line speed
    const metrics = calculateMetrics();
    const launchInterval = metrics.effectiveCycleTime;
    const conveyorSpeed = metrics.conveyorSpeed;

    if (conveyorSpeed <= 0 || !isFinite(conveyorSpeed)) return { tasks: [] };

    let allFinishedTasks = [];

    // Initialize arrivals
    let arrivalsForNextStation = productionQueue.map((modelId, index) => ({
        modelId: modelId,
        arrivalTime: index * launchInterval,
        uniqueId: `${modelId}-${index}`
    }));

    const sortedStationIds = Object.keys(config).map(Number).sort((a, b) => a - b);

    // Calculate total element time of line for travel time ratio
    const totalLineTime = systemState.elements.reduce((sum, el) => sum + el.baseTime, 0);
    const totalPhysicalThroughputTime = systemState.assemblyLineLength / conveyorSpeed;

    for (const stationId of sortedStationIds) {
        const taskIds = config[stationId];
        if (!taskIds || taskIds.length === 0) continue;

        let workerFreeTime = 0;
        let processedModels = [];

        // Calculate travel time for this specific station based on its work content
        const stationBaseTime = taskIds.reduce((sum, tid) => {
            const t = systemState.elements.find(e => e.id === tid);
            return sum + (t ? t.baseTime : 0);
        }, 0);

        let travelTimeMinutes = 0;
        if (totalLineTime > 0) {
            travelTimeMinutes = (stationBaseTime / totalLineTime) * totalPhysicalThroughputTime;
        }

        arrivalsForNextStation.sort((a, b) => a.arrivalTime - b.arrivalTime);

        for (const model of arrivalsForNextStation) {
            const startProcessingTime = Math.max(model.arrivalTime, workerFreeTime);
            let currentTaskTime = startProcessingTime;

            // Execute tasks in this station
            for (const elementId of taskIds) {
                // Check if this task is required for this model
                if (doesElementBuildModel(elementId, model.modelId)) {
                    const task = systemState.elements.find(e => e.id === elementId);
                    if (task) {
                        const taskStartTime = currentTaskTime;
                        const taskEndTime = taskStartTime + task.baseTime;

                        allFinishedTasks.push({
                            workstationId: `WS ${stationId}`,
                            modelId: model.modelId,
                            taskId: elementId,
                            startTime: taskStartTime,
                            endTime: taskEndTime,
                            uniqueId: model.uniqueId
                        });
                        currentTaskTime = taskEndTime;
                    }
                }
            }

            const endProcessingTime = currentTaskTime;
            workerFreeTime = endProcessingTime;

            // Product must physically travel across station length
            const endTravelTime = model.arrivalTime + travelTimeMinutes;
            const exitTime = Math.max(endProcessingTime, endTravelTime);

            processedModels.push({ ...model, arrivalTime: exitTime });
        }
        arrivalsForNextStation = processedModels;
    }

    return { tasks: allFinishedTasks };
}

/**
 * Caching Key Generator
 */
function getFinancialInputsKey() {
    const finInputs = {
        laborCost: parseFloat(laborCostInput.value),
        superSell: parseFloat(superSellInput.value),
        // Includes a hash of the entire system configuration to invalidate cache on config change
        stateHash: JSON.stringify(systemState.configData)
    };
    return 'profitDataCache-vDyn-' + JSON.stringify(finInputs);
}

/**
 * Main Profit Calculation Entry Point
 */
function runProfitCalculation() {
    const cacheKey = getFinancialInputsKey();
    const cachedData = sessionStorage.getItem(cacheKey);
    if (cachedData) {
        profitMaximizationCache = { key: cacheKey, data: JSON.parse(cachedData) };
        if (document.querySelector('.tab-btn.active')?.dataset.tab === 'profit') {
            ProfitTab.draw();
        }
    } else {
        calculateOptimalProfitData();
    }
}

/**
 * Generates data for Profit Tab by iterating demand 50->552
 */
async function calculateOptimalProfitData() {
    if (isProfitCalculating) return;
    isProfitCalculating = true;

    // Snapshot current inputs
    const finInputs = { ...liveState };

    setTimeout(() => {
        const profitData = [];
        const marginData = [];

        // Iterate demand from 50 to 552
        for (let demand = 50; demand <= 552; demand += 10) {
            const { profitResult, marginResult } = findOptimalConfigForDemand(demand, finInputs);
            profitData.push(profitResult);
            marginData.push(marginResult);
        }

        const calculatedData = { profitData, marginData };
        const key = getFinancialInputsKey();
        profitMaximizationCache = { key, data: calculatedData };
        sessionStorage.setItem(key, JSON.stringify(calculatedData));

        isProfitCalculating = false;
        if (document.querySelector('.tab-btn.active')?.dataset.tab === 'profit') {
            ProfitTab.draw();
        }
    }, 100);
}

/**
 * Finds best emp/hours configuration for a specific demand point.
 */
function findOptimalConfigForDemand(demand, finInputs) {
    let maxProfit = -Infinity;
    let maxProfitConfig = { emp: 0, hrs: 0 };
    let maxMargin = -Infinity;
    let maxMarginConfig = { emp: 0, hrs: 0 };

    const qualityYield = (finInputs.qualityYieldInput || 100) / 100;

    // Iterate over available workstation counts in the dynamic config
    const availableEmployeeCounts = Object.keys(systemState.configData).map(Number);

    for (let numEmployees of availableEmployeeCounts) {
        const { bottleneckTime } = calculateWorkstationDetails(numEmployees);
        if (bottleneckTime <= 0) continue;

        const minRequiredHours = (demand * bottleneckTime) / 60;

        if (minRequiredHours > 24) continue;

        // Round up to quarter hour
        const opHours = Math.ceil(minRequiredHours / 0.25) * 0.25;

        // Calculate Financials
        let revenue = 0;
        let cogs = 0;
        let rework = 0;

        systemState.models.forEach((m, i) => {
            // Map legacy inputs (0=Super, 1=Ultra, 2=Mega)
            let s = 0, c = 0, r = 0;
            if (i === 0) { s = finInputs.superSell; c = finInputs.superCogs; r = finInputs.superRework; }
            else if (i === 1) { s = finInputs.ultraSell; c = finInputs.ultraCogs; r = finInputs.ultraRework; }
            else if (i === 2) { s = finInputs.megaSell; c = finInputs.megaCogs; r = finInputs.megaRework; }

            const units = demand * m.ratio;
            revenue += units * s;
            cogs += units * c;
            rework += units * (1 - qualityYield) * r;
        });

        const labor = numEmployees * opHours * finInputs.laborCost;
        const profit = revenue - cogs - labor - rework;
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

        if (profit > maxProfit) {
            maxProfit = profit;
            maxProfitConfig = { emp: numEmployees, hrs: opHours };
        }
        if (margin > maxMargin) {
            maxMargin = margin;
            maxMarginConfig = { emp: numEmployees, hrs: opHours };
        }
    }

    return {
        profitResult: { demand, value: maxProfit > -Infinity ? maxProfit : 0, config: maxProfitConfig },
        marginResult: { demand, value: maxMargin > -Infinity ? maxMargin : 0, config: maxMarginConfig }
    };
}

function onSaveConfiguration() {
    const timestamp = new Date().toISOString();

    // Save current inputs
    const inputs = { ...liveState };

    // Save dynamic configuration state
    const savedConfig = {
        timestamp,
        inputs,
        systemState: JSON.parse(JSON.stringify(systemState)),
        visualizationSnapshots: captureActiveVisualizationSnapshot(),
        cityData: window.getCityData ? window.getCityData() : []
    };

    lastSavedConfig = savedConfig;
    localStorage.setItem(LOCAL_SAVE_KEY, JSON.stringify(lastSavedConfig));

    renderSavedPreview();
    updateCompareBtn();

    if (saveConfigBtn) {
        const originalText = saveConfigBtn.textContent;
        saveConfigBtn.textContent = "Saved!";
        setTimeout(() => saveConfigBtn.textContent = originalText, 2000);
    }
}

function loadSavedConfig() {
    const saved = localStorage.getItem(LOCAL_SAVE_KEY);
    if (saved) {
        lastSavedConfig = JSON.parse(saved);
        renderSavedPreview();
        updateCompareBtn();
    }
}

function renderSavedPreview() {
    const el = document.getElementById('savedConfigPreview');
    if (!el || !lastSavedConfig) return;
    const date = new Date(lastSavedConfig.timestamp).toLocaleDateString();
    el.innerHTML = `<small>Saved: ${date} <br> ${lastSavedConfig.systemState.models.length} Models</small>`;
}

// Replaces the empty stub
function updateCompareBtn() {
    if (!compareBtn) return;
    compareBtn.disabled = !lastSavedConfig;
    compareBtn.textContent = (currentView === 'saved') ? "Back to Current" : "Compare Saved";
    compareBtn.classList.toggle('active', currentView === 'saved');
}

function onCompareBtnClick() {
    if (currentView === 'current') switchCompareView('saved');
    else switchCompareView('current');
}

function switchCompareView(view) {
    isSavedMode = (view === 'saved');
    currentView = view;
    allowInputCommitCallbacks = false;

    if (isSavedMode && lastSavedConfig) {
        // 1. Cache Current State
        window.tempCurrentSystemState = JSON.parse(JSON.stringify(systemState));
        window.tempCurrentInputs = { ...liveState };

        // 2. Load Saved State
        systemState = JSON.parse(JSON.stringify(lastSavedConfig.systemState));
        // Restore Inputs
        Object.keys(lastSavedConfig.inputs).forEach(k => {
            const el = document.getElementById(k);
            if (el) {
                el.value = lastSavedConfig.inputs[k];
                liveState[k] = parseFloat(el.value);
            }
        });

        // 3. Update Derived State maps
        state.taskData = new Map(systemState.elements.map(e => [e.id, {
            laborTime: e.baseTime, elementTime: e.baseTime, description: e.description,
            Super: e.usage.includes(1) ? 1 : 0, Ultra: e.usage.includes(2) ? 1 : 0, Mega: e.usage.includes(3) ? 1 : 0
        }]));
        state.configData = systemState.configData;

    } else {
        // Restore Current
        if (window.tempCurrentSystemState) {
            systemState = window.tempCurrentSystemState;
            Object.keys(window.tempCurrentInputs).forEach(k => {
                const el = document.getElementById(k);
                if (el) {
                    el.value = window.tempCurrentInputs[k];
                    liveState[k] = parseFloat(el.value);
                }
            });

            // Restore Maps
            state.taskData = new Map(systemState.elements.map(e => [e.id, {
                laborTime: e.baseTime, elementTime: e.baseTime, description: e.description,
                Super: e.usage.includes(1) ? 1 : 0, Ultra: e.usage.includes(2) ? 1 : 0, Mega: e.usage.includes(3) ? 1 : 0
            }]));
            state.configData = systemState.configData;
        }
    }

    updateCompareBtn();
    updateUI({ forceRedraw: true });
    allowInputCommitCallbacks = true;
}

function captureActiveVisualizationSnapshot() {
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    const panel = document.getElementById(`${activeTab}-panel`);
    return panel ? { [activeTab]: panel.innerHTML } : {};
}

/**
 * Calculates the total Assembly Line Length based on model physics.
 * Logic: (2 * Max(Shortest_Dimension)) * (Total_Time / Min_Atomic_Time)
 */
function calculateAssemblyLineLength() {
    // Fallback if data is missing
    if (!systemState.models || systemState.models.length === 0 || !systemState.elements || systemState.elements.length === 0) {
        systemState.assemblyLineLength = 486;
        return 486;
    }

    // 1. Find the physical space allocation per unit
    // "Space equal to double the largest of the models' shortest dimensionality"
    let maxShortestDimension = 0;
    systemState.models.forEach(m => {
        const shortest = Math.min(m.length, m.width, m.height);
        if (shortest > maxShortestDimension) maxShortestDimension = shortest;
    });

    // Store for Layout tab usage if needed
    systemState.productDimensions.maxShortestDim = maxShortestDimension;

    const spacePerUnit = 2 * maxShortestDimension;

    // 2. Calculate the Time Ratio
    // "Ratio of total element time divided by the smallest individual element time"
    let totalTime = 0;
    let minTime = Infinity;

    systemState.elements.forEach(el => {
        // Calculate weighted average time for the element based on model usage
        let weightedTime = 0;
        let totalRatio = 0;

        systemState.models.forEach(model => {
            if (el.usage.includes(model.id)) {
                weightedTime += el.baseTime * model.ratio;
                totalRatio += model.ratio;
            }
        });

        // Use weighted time if specific models are selected, else base time
        const effectiveTime = totalRatio > 0 ? weightedTime : el.baseTime;

        totalTime += effectiveTime;
        if (effectiveTime < minTime && effectiveTime > 0) minTime = effectiveTime;
    });

    const timeRatio = minTime > 0 ? (totalTime / minTime) : 0;

    // 3. Update State
    // Ensure we don't get 0 length
    const calculatedLength = Math.ceil(spacePerUnit * timeRatio);
    systemState.assemblyLineLength = calculatedLength > 0 ? calculatedLength : 486;

    return systemState.assemblyLineLength;
}

/**
 * Dynamically calculates max demand thresholds for every workstation configuration
 * available in configData. Replaces the static WORKSTATION_CAPACITIES array.
 */
function calculateCapacityThresholds() {
    const capacities = [];
    const MAX_OP_MINUTES = 24 * 60; // Max theoretical day (1440 mins)

    if (!systemState.configData) return;

    Object.keys(systemState.configData).forEach(wsCount => {
        const config = systemState.configData[wsCount];
        let bottleneck = 0;

        // Find bottleneck for this configuration
        Object.values(config).forEach(tasks => {
            const stationTime = tasks.reduce((sum, taskId) => {
                const el = systemState.elements.find(e => e.id === taskId);
                // Weighted time calculation for bottleneck capacity
                let weightedTime = 0;
                let totalRatio = 0;
                if (el) {
                    systemState.models.forEach(model => {
                        if (el.usage.includes(model.id)) {
                            weightedTime += el.baseTime * model.ratio;
                            totalRatio += model.ratio;
                        }
                    });
                    return sum + (totalRatio > 0 ? weightedTime : el.baseTime);
                }
                return sum;
            }, 0);

            if (stationTime > bottleneck) bottleneck = stationTime;
        });

        if (bottleneck > 0) {
            capacities.push({
                ws: parseInt(wsCount),
                maxDemand: Math.floor(MAX_OP_MINUTES / bottleneck)
            });
        }
    });

    // Sort by workstation count
    systemState.capacities = capacities.sort((a, b) => a.ws - b.ws);
}

/**
 * Halts all running `requestAnimationFrame` loops for the layout and
 * schedule simulations.
 */
function stopAllSimulations() {
    if (animationState.layout.frameId) {
        cancelAnimationFrame(animationState.layout.frameId);
        animationState.layout.frameId = null;
        animationState.layout.isRunning = false;
    }
    if (animationState.schedule.frameId) {
        cancelAnimationFrame(animationState.schedule.frameId);
        animationState.schedule.frameId = null;
        animationState.schedule.isRunning = false;
    }
}

function setupUIEventListeners() {
    // 1. Sidebar Toggles
    leftToggle.addEventListener('click', () => {
        document.getElementById('left-sidebar').classList.toggle('collapsed');
        leftToggle.innerHTML = document.getElementById('left-sidebar').classList.contains('collapsed') ? '&raquo;' : '&laquo;';
    });

    rightToggle.addEventListener('click', () => {
        document.getElementById('right-sidebar').classList.toggle('collapsed');
        rightToggle.innerHTML = document.getElementById('right-sidebar').classList.contains('collapsed') ? '&laquo;' : '&raquo;';
    });

    // 2. Tab Navigation
    tabs.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn')) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const target = e.target.dataset.tab;
            visPanels.forEach(p => p.style.display = (p.id === `${target}-panel` ? 'block' : 'none'));

            // Stop simulations when switching away
            stopAllSimulations();

            renderActiveTab();
        }
    });

    // 3. Create the Auto-Adjust Toggle Switch
    const switchContainer = document.createElement('div');
    switchContainer.style.display = 'flex';
    switchContainer.style.alignItems = 'center';
    switchContainer.style.gap = '5px';

    const switchText = document.createElement('span');
    switchText.textContent = 'Auto\nAdjust';
    switchText.style.fontSize = 'clamp(0.7rem, 0.9vw, 0.85rem)';
    switchText.style.fontWeight = 'bold';
    switchText.style.verticalAlign = 'top';
    switchText.style.whiteSpace = 'pre-wrap';

    const switchLabel = document.createElement('label');
    switchLabel.className = 'switch';

    const switchInput = document.createElement('input');
    switchInput.type = 'checkbox';
    switchInput.id = 'autoAdjustToggle';
    switchInput.checked = autoAdjustEnabled;

    const sliderSpan = document.createElement('span');
    sliderSpan.className = 'slider';

    switchLabel.append(switchInput, sliderSpan);
    switchContainer.append(switchText, switchLabel);
    switchContainer.style.gap = '6px';

    // Logic: Reset manual overrides when re-enabling
    switchInput.addEventListener('change', () => {
        autoAdjustEnabled = switchInput.checked;
        if (autoAdjustEnabled) {
            if (qualityYieldInput) qualityYieldInput.dataset.userModified = "false";
            handleInputChange('dailyDemand'); // Trigger recalculation
        }
    });

    // 4. Insert the Switch into the Right Sidebar
    const dailyDemandEl = document.getElementById('dailyDemand');
    // Find the container of dailyDemand (usually .input-group)
    const demandInputContainer = dailyDemandEl ? dailyDemandEl.closest('.input-group') : null;

    if (demandInputContainer) {
        // Find the "Operational Inputs" header (previous sibling)
        const operationalTitle = demandInputContainer.previousElementSibling;

        if (operationalTitle && (operationalTitle.tagName === 'H3' || operationalTitle.tagName === 'H4')) {
            // Create a wrapper to hold Title + Switch
            const titleWrapper = document.createElement('div');
            titleWrapper.style.display = 'flex';
            titleWrapper.style.justifyContent = 'space-between';
            titleWrapper.style.alignItems = 'center';
            titleWrapper.style.marginBottom = getComputedStyle(operationalTitle).marginBottom;

            // Remove margin from title so it fits in wrapper
            operationalTitle.style.marginBottom = '0';

            // Insert wrapper before the title
            operationalTitle.parentNode.insertBefore(titleWrapper, operationalTitle);

            // Move title and switch into wrapper
            titleWrapper.appendChild(operationalTitle);
            titleWrapper.appendChild(switchContainer);
        } else {
            // Fallback: just prepend to sidebar
            const rs = document.getElementById('right-sidebar');
            if (rs) rs.insertBefore(switchContainer, rs.firstChild);
        }
    }
}

// Boot
document.addEventListener('DOMContentLoaded', main);