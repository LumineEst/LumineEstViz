let highsScriptLoaded = false;
let highsScriptError = null;
let highsLoaderFunction = null;
let highsInstancePromise = null;

// Attempt to load the HiGHS solver script
try {
    importScripts('libs/highs.js');
    highsLoaderFunction = Module;
    highsScriptLoaded = true;
} catch (error) {
    highsScriptError = `Failed to import script 'libs/highs.js': ${error.message}`;
    console.error("WORKER: CRITICAL -", highsScriptError, error);
}

// --- Async Solver Loader ---
async function getSolverInstance() {
    if (!highsScriptLoaded || !highsLoaderFunction) {
        throw new Error(highsScriptError || "HiGHS script did not load or define loader.");
    }
    if (!highsInstancePromise) {
        const wasmPath = 'libs/';
        const memoryMB = 512;
        const initialMemory = memoryMB * 1024 * 1024;
        highsInstancePromise = highsLoaderFunction({
            locateFile: (filename) => wasmPath + filename,
            initialMemory: initialMemory
        })
            .then(instance => {
                if (!instance?.solve) {
                    throw new Error("HiGHS instance invalid or missing 'solve' method.");
                }
                return instance;
            })
            .catch(err => {
                console.error("WORKER: Failed to initialize HiGHS WASM instance:", err);
                highsInstancePromise = null;
                throw err;
            });
    }
    return highsInstancePromise;
}

// --- Async MILP Helper Function ---
async function findOptimalShipmentSchedule(cities, scheduleData) {
    let solverInstance;

    // --- 1. Prepare / Fallback Logic ---
    const runFallback = (reason) => {
        console.warn(`WORKER: Using Heuristic Schedule. Reason: ${reason}`);
        // Reset schedule
        (scheduleData || []).forEach(d => { if (d) { d.shipments = 0; d.shipmentDetails = []; } });

        // FIX: Use linear spacing instead of modulo to prevent clustering
        // If we have 10 cities with 365 day freq, place them at 0%, 10%, 20%... of the year.
        const totalCities = cities.length || 1;

        cities.forEach((c, i) => {
            const freq = Math.max(1, Math.round(c.freq || 7));

            let startDay = 1;
            if (c.chosenStartDay > 0 && c.chosenStartDay <= freq) {
                startDay = c.chosenStartDay;
            } else {
                // Linear spread logic:
                // City 0 -> Day 1
                // City 5 (of 10) -> Day ~182 (if freq 365)
                const ratio = i / totalCities;
                startDay = Math.floor(ratio * freq) + 1;
            }

            const startDay_0idx = startDay - 1;
            for (let t = startDay_0idx; t < 365; t += freq) {
                if (scheduleData[t]) {
                    scheduleData[t].shipments += c.qty;
                    scheduleData[t].shipmentDetails.push({ city: c.name, qty: c.qty, freq: freq, startDay: startDay });
                }
            }
        });
        return { status: `fallback_${reason}`, peakDemand: -1, dailyData: scheduleData };
    };

    try {
        solverInstance = await getSolverInstance();
    } catch (error) {
        return runFallback("solver_load_failed");
    }

    // --- 2. LP String Generation (Optimized) ---
    try {
        let lpString = "Minimize\n obj: 1 Z\nSubject To\n";
        const binaryVars = [];
        const generalVars = ["Z"];

        // Map structure: dayIndex (0-364) -> Array of variable strings
        const dayConstraintsMap = new Array(365).fill(null).map(() => []);

        (cities || []).forEach((city, cityIndex) => {
            const freq = Math.max(1, Math.round(city.freq));

            // Step Optimization for large frequencies
            let step = 1;
            if (freq > 90) step = 15;
            else if (freq > 30) step = 7;
            else if (freq > 10) step = 2;

            // FIX: Stagger the *sampling* of start days based on city index.
            // If City A and City B both check [1, 15, 30...], the solver puts both on Day 1.
            // We shift City B to check [5, 20, 35...] so its "lazy" default is Day 5, not Day 1.
            const staggerOffset = Math.floor((cityIndex * 13) % freq);

            let possibleStartDays = [];

            // Generate staggered options
            for (let d = 1; d <= freq; d += step) {
                let dayVal = d + staggerOffset;
                if (dayVal > freq) dayVal = (dayVal % freq) || freq; // Wrap around 1-freq
                possibleStartDays.push(dayVal);
            }

            // Always include user choice if present
            if (city.chosenStartDay > 0 && city.chosenStartDay <= freq) {
                possibleStartDays.push(city.chosenStartDay);
            }

            possibleStartDays = [...new Set(possibleStartDays)].sort((a, b) => a - b);

            const constraintName = `c_${cityIndex}_sel`;
            let selectionParts = [];

            possibleStartDays.forEach((startDay) => {
                const varName = `x_${cityIndex}_${startDay}`;
                binaryVars.push(varName);

                // 1. Selection Constraint Part
                selectionParts.push(`1 ${varName}`);

                // 2. Day Load Constraints (Pre-calculated)
                const startDay0 = startDay - 1;
                for (let t = startDay0; t < 365; t += freq) {
                    dayConstraintsMap[t].push(`${city.qty} ${varName}`);
                }
            });

            // "Select exactly one start day"
            if (city.chosenStartDay > 0) {
                lpString += ` ${constraintName}: 1 x_${cityIndex}_${city.chosenStartDay} = 1\n`;
            } else {
                lpString += ` ${constraintName}: ${selectionParts.join(' + ')} = 1\n`;
            }
        });

        // Assemble Day Constraints
        for (let t = 0; t < 365; t++) {
            const parts = dayConstraintsMap[t];
            if (parts.length > 0) {
                lpString += ` d_${t}: ${parts.join(' + ')} - 1 Z <= 0\n`;
            }
        }

        // Variable Bounds/Types
        lpString += "Bounds\n";
        lpString += "General\n " + generalVars.join(' ') + "\n";
        lpString += "Binary\n " + binaryVars.join(' ') + "\n";
        lpString += "End\n";

        // --- 3. Solve ---
        const result = await solverInstance.solve(lpString);

        const status = result?.Status || "";
        if (status !== "Optimal" && status !== "Feasible") {
            return runFallback(`solver_status_${status.replace(/\s+/g, '_')}`);
        }

        // --- 4. Parse & Apply ---
        const cols = result.Columns || {};
        const peakDemand = cols["Z"]?.Primal || 0;

        (scheduleData || []).forEach(d => { if (d) { d.shipments = 0; d.shipmentDetails = []; } });

        cities.forEach((city, cityIndex) => {
            const freq = Math.max(1, Math.round(city.freq));
            let selectedStartDay = -1;

            // Find selected variable
            const prefix = `x_${cityIndex}_`;
            for (const [key, colData] of Object.entries(cols)) {
                if (key.startsWith(prefix)) {
                    if (colData.Primal > 0.5) {
                        selectedStartDay = parseInt(key.split('_')[2]);
                        break;
                    }
                }
            }

            if (selectedStartDay === -1) selectedStartDay = (city.chosenStartDay > 0) ? city.chosenStartDay : 1;

            const startDay0 = selectedStartDay - 1;
            for (let t = startDay0; t < 365; t += freq) {
                if (scheduleData[t]) {
                    scheduleData[t].shipments += city.qty;
                    scheduleData[t].shipmentDetails.push({
                        city: city.name,
                        qty: city.qty,
                        freq: freq,
                        startDay: selectedStartDay
                    });
                }
            }
        });

        return { status: 'optimal', peakDemand: peakDemand, dailyData: scheduleData };

    } catch (e) {
        console.error("WORKER: LP Generation or Execution Error", e);
        return runFallback("exception_during_solve");
    }
}

/**
 * Runs the main day-by-day inventory simulation.
 */
async function performSimulation(params) {
    let dailyData = null;
    let functionStep = "1. Deconstruct Params";
    try {
        const {
            cities, workingDaysSchedule, standardOpHours, numEmployees, laborCost,
            holdingCostRate, annualMfgOverhead, annualSgaExpenses,
            superCogsVal, ultraCogsVal, mcInputVal, buildRatios,
            targetDailyProduction,
            maxStandardProduction
        } = params;

        if (typeof targetDailyProduction === 'undefined' || typeof maxStandardProduction === 'undefined') {
            throw new Error("Missing critical parameters: targetDailyProduction or maxStandardProduction.");
        }

        const workingDaysSet = new Set(workingDaysSchedule);
        const numWorkingDays = workingDaysSchedule.length;
        const dailyHoldingRate = holdingCostRate / 365.0;
        const dailyMfgOverhead = numWorkingDays > 0 ? annualMfgOverhead / numWorkingDays : 0;
        const dailySgaExpenses = numWorkingDays > 0 ? annualSgaExpenses / numWorkingDays : 0;
        const avgCogs = (superCogsVal * buildRatios.super) + (ultraCogsVal * buildRatios.ultra) + (mcInputVal * buildRatios.mega);

        if (maxStandardProduction <= 0) throw new Error("Max standard production must be > 0.");
        if (standardOpHours <= 0) throw new Error("Std operating hours must be > 0.");
        const productionPerStdHour = maxStandardProduction / standardOpHours;
        const targetEndInventory = 0;

        // --- 2. Initialize Data Array ---
        functionStep = "2. Initialize dailyData";
        dailyData = Array.from({ length: 365 }, (_, i) => {
            const year = new Date().getFullYear();
            const date = new Date(Date.UTC(year, 0, i + 1));
            const dayStr = date.toISOString().split('T')[0];
            return {
                day: i, date: dayStr,
                isWorkingDay: workingDaysSet.has(dayStr),
                production: 0, opHours: 0, inventoryStart: 0, inventoryAvailable: 0,
                shipments: 0, shipmentDetails: [],
                actualShipments: 0, actualShipmentDetails: [],
                demandMet: true, inventoryEnd: 0,
                holdingCost: 0, exceptionCost: 0,
                isExceptionDay: false, isReductionDay: false, shipmentDeferred: false
            };
        });

        // --- 3. Run Optimizer / Heuristic ---
        functionStep = "3. Run Optimizer/Heuristic";
        if (cities && cities.length > 0) {
            await findOptimalShipmentSchedule(cities, dailyData);
        } else {
            dailyData.forEach(d => { if (d) { d.shipments = 0; d.shipmentDetails = []; } });
        }

        if (!cities || cities.length === 0) {
            return { results: dailyData };
        }

        // --- 4. Simulation Loop (Pass 1) ---
        functionStep = "4. Simulation Loop (Pass 1)";
        let accumulatedExtraHours = 0;
        let simulationError = null;

        function runSimLoop(dataArray, passName = "Pass 1", minInventoryCushion = -Infinity) {
            let simError = null;
            let otHours = 0;

            for (let day = 0; day < 365; day++) {
                const d = dataArray[day];
                if (!d) continue;

                d.inventoryStart = (day === 0) ? 0 : (dataArray[day - 1]?.inventoryEnd ?? 0);

                // TIER 1: Standard Production
                if (passName === "Pass 1") {
                    d.production = 0; d.opHours = 0;
                    if (d.isWorkingDay && !d.isReductionDay && !d.isExceptionDay) {
                        if (targetDailyProduction > 0) {
                            if (targetDailyProduction > maxStandardProduction) {
                                d.production = maxStandardProduction;
                                d.opHours = standardOpHours;
                            } else {
                                d.production = targetDailyProduction;
                                d.opHours = (productionPerStdHour > 0) ? (targetDailyProduction / productionPerStdHour) : 0;
                            }
                        }
                    }
                }

                d.inventoryAvailable = d.inventoryStart + d.production;

                // Shipments Logic
                let shipmentsScheduledToday = (passName === "Pass 1") ? (d.shipments || 0) : d.actualShipments;
                let detailsScheduledToday = (passName === "Pass 1") ? (d.shipmentDetails || []) : d.actualShipmentDetails;

                d.actualShipments = 0;
                if (passName === "Pass 1") d.actualShipmentDetails = [];

                // Deferred Shipment Logic (Week 1 only)
                if (passName === "Pass 1" && day < 7 && shipmentsScheduledToday > 0 && d.inventoryAvailable < shipmentsScheduledToday) {
                    for (let targetDay = day + 1; targetDay <= Math.min(364, day + 7); targetDay++) {
                        if (dataArray[targetDay] && dataArray[targetDay].isWorkingDay) {
                            dataArray[targetDay].shipments = (dataArray[targetDay].shipments || 0) + shipmentsScheduledToday;
                            dataArray[targetDay].shipmentDetails = (dataArray[targetDay].shipmentDetails || []).concat(detailsScheduledToday);
                            d.shipments = 0; d.shipmentDetails = [];
                            shipmentsScheduledToday = 0; detailsScheduledToday = [];
                            d.shipmentDeferred = true;
                            d.exceptionDetails = `Shipment deferred to day ${targetDay}.`;
                            break;
                        }
                    }
                }

                const finalShipmentsNeeded = shipmentsScheduledToday;
                const finalDetailsNeeded = detailsScheduledToday;

                // Shortfall Logic
                if (finalShipmentsNeeded > 0 && d.inventoryAvailable < finalShipmentsNeeded) {
                    let remainingShortfall = finalShipmentsNeeded - d.inventoryAvailable;
                    d.demandMet = false;
                    let exceptionDaysUsed = [];

                    // TIER 2: Current Day Flex
                    if (remainingShortfall > 0.01 && workingDaysSet.has(d.date) && !d.isReductionDay && !d.isExceptionDay) {
                        const potentialExtra = maxStandardProduction - d.production;
                        if (potentialExtra > 0.01) {
                            const add = Math.min(remainingShortfall, potentialExtra);
                            const hrs = add / productionPerStdHour;
                            // Ensure we don't exceed std hours logic if capacity is limited by time
                            const timeRoom = standardOpHours - d.opHours;
                            const feasibleHrs = Math.min(hrs, timeRoom);
                            const actualAdd = Math.floor(feasibleHrs * productionPerStdHour);

                            if (actualAdd > 0) {
                                d.production += actualAdd;
                                d.opHours += feasibleHrs;
                                d.inventoryAvailable += actualAdd;
                                remainingShortfall -= actualAdd;
                                if (passName === "Pass 1") {
                                    const msg = `Flexed to max capacity (+${actualAdd.toFixed(0)}u).`;
                                    d.exceptionDetails = d.exceptionDetails ? `${d.exceptionDetails}; ${msg}` : msg;
                                }
                            }
                        }
                    }

                    // TIER 3: Reactive OT
                    if (remainingShortfall > 0.01) {
                        for (let p = day - 1; p >= 0 && remainingShortfall > 0.01; p--) {
                            if (!dataArray[p]) continue;
                            const dp = dataArray[p];
                            if (workingDaysSet.has(dp.date) && !dp.isReductionDay) {
                                const maxExHours = Math.min(24, Math.max(12, standardOpHours * 1.5));
                                const potHours = maxExHours - dp.opHours;
                                if (potHours > 0.01) {
                                    const maxProd = Math.floor(potHours * productionPerStdHour);
                                    if (maxProd > 0) {
                                        const add = Math.min(remainingShortfall, maxProd);
                                        const hrs = add / productionPerStdHour;

                                        dp.production += add;
                                        dp.opHours += hrs;
                                        dp.isExceptionDay = true;

                                        if (passName === "Pass 1") {
                                            const cost = hrs * numEmployees * laborCost * 0.5; // OT Premium
                                            const overhead = (dailyMfgOverhead + dailySgaExpenses) * (hrs / standardOpHours);
                                            dp.exceptionCost = (dp.exceptionCost || 0) + cost + overhead;
                                            otHours += hrs;
                                            const msg = `Reactive OT: +${hrs.toFixed(2)}h`;
                                            dp.exceptionDetails = dp.exceptionDetails ? `${dp.exceptionDetails}; ${msg}` : msg;
                                        }

                                        d.inventoryAvailable += add; // It arrived in time for today
                                        remainingShortfall -= add;
                                        exceptionDaysUsed.push(p);
                                    }
                                }
                            }
                        }
                    }

                    if (remainingShortfall <= 0.01) d.demandMet = true;

                    if (!d.demandMet) {
                        if (passName === "Pass 1") {
                            simError = `Demand Conflict Day ${day + 1}: Short by ${remainingShortfall.toFixed(0)}`;
                            d.exceptionDetails = `CRITICAL SHORTFALL: ${remainingShortfall.toFixed(0)}u`;
                            d.isExceptionDay = true;
                        } else {
                            simError = "Optimization constraint failure";
                        }
                    }
                }

                // Inventory Cushion Check (Optimization Passes only)
                if (passName !== "Pass 1" && (d.inventoryAvailable - finalShipmentsNeeded) < (minInventoryCushion - 0.01)) {
                    simError = "Dipped below cushion";
                }

                if (simError) {
                    d.inventoryEnd = d.inventoryAvailable - (Math.min(d.inventoryAvailable, finalShipmentsNeeded));
                    break;
                }

                // Finalize Day
                d.actualShipments = Math.min(d.inventoryAvailable, finalShipmentsNeeded);
                d.inventoryEnd = d.inventoryAvailable - d.actualShipments;

                if (passName === "Pass 1") {
                    let remaining = d.actualShipments;
                    d.actualShipmentDetails = [];
                    for (const det of finalDetailsNeeded) {
                        if (remaining <= 0) break;
                        const qty = Math.min(det.qty, remaining);
                        if (qty > 0) {
                            d.actualShipmentDetails.push({ ...det, qty });
                            remaining -= qty;
                        }
                    }
                    d.holdingCost = Math.max(0, d.inventoryEnd) * avgCogs * dailyHoldingRate;
                }
            }
            return { error: simError, otHours };
        }

        const pass1 = runSimLoop(dailyData, "Pass 1");
        simulationError = pass1.error;
        accumulatedExtraHours = pass1.otHours;

        if (simulationError) {
            console.error("WORKER: Simulation Pass 1 Error:", simulationError);
        } else {
            // --- 7. Optimization Passes ---
            function runSafetyCheck(startIndex, newProd, minLevel) {
                let currentInv = (startIndex === 0) ? 0 : dailyData[startIndex - 1].inventoryEnd;
                for (let i = startIndex; i < 365; i++) {
                    const d = dailyData[i];
                    const prod = (i === startIndex) ? newProd : d.production;
                    const avail = currentInv + prod;
                    if (avail < d.actualShipments) return false;
                    currentInv = avail - d.actualShipments;
                    if (currentInv < (minLevel - 0.01)) return false;
                }
                return true;
            }

            // 7.1 Forward Pass (Slack Removal)
            let minSafe = Infinity;
            for (let i = 0; i < 365; i++) {
                if (dailyData[i].actualShipments > 0 && dailyData[i].inventoryStart < minSafe) {
                    minSafe = dailyData[i].inventoryStart;
                }
            }
            if (minSafe === Infinity) minSafe = 0;

            for (let day = 0; day < 365; day++) {
                const d = dailyData[day];
                if (workingDaysSet.has(d.date) && !d.isExceptionDay && !d.isReductionDay && d.production > 0) {
                    if (Math.abs(d.production - targetDailyProduction) < 0.01) {
                        if (runSafetyCheck(day, 0, minSafe)) {
                            d.production = 0; d.opHours = 0; d.isReductionDay = true;
                            // Propagate
                            for (let k = day; k < 365; k++) {
                                const dk = dailyData[k];
                                dk.inventoryStart = (k === 0 ? 0 : dailyData[k - 1].inventoryEnd);
                                dk.inventoryAvailable = dk.inventoryStart + dk.production;
                                dk.inventoryEnd = dk.inventoryAvailable - dk.actualShipments;
                            }
                        }
                    }
                }
            }

            // 7.2 Backward Pass (OT Offset)
            let hoursToOffset = accumulatedExtraHours;
            if (hoursToOffset > 0.01) {
                for (let day = 364; day >= 0; day--) {
                    if (hoursToOffset <= 0.01) break;
                    const d = dailyData[day];
                    if (workingDaysSet.has(d.date) && !d.isExceptionDay && !d.isReductionDay && d.production > 0) {
                        if (Math.abs(d.production - targetDailyProduction) < 0.01) {
                            if (runSafetyCheck(day, 0, targetEndInventory)) {
                                const savedHrs = d.opHours;
                                if (hoursToOffset >= savedHrs) {
                                    d.production = 0; d.opHours = 0; d.isReductionDay = true;
                                    d.exceptionDetails = (d.exceptionDetails || "") + " Offset OT.";
                                    hoursToOffset -= savedHrs;
                                    // Propagate
                                    for (let k = day; k < 365; k++) {
                                        const dk = dailyData[k];
                                        dk.inventoryStart = (k === 0 ? 0 : dailyData[k - 1].inventoryEnd);
                                        dk.inventoryAvailable = dk.inventoryStart + dk.production;
                                        dk.inventoryEnd = dk.inventoryAvailable - dk.actualShipments;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 8. Final Recalc Costs
        dailyData.forEach(d => {
            d.isWorkingDay = workingDaysSet.has(d.date) && !d.isReductionDay;
            d.holdingCost = Math.max(0, d.inventoryEnd) * avgCogs * dailyHoldingRate;
        });

        // 9. Return
        if (simulationError) return { error: simulationError, results: dailyData };
        return { results: dailyData };

    } catch (e) {
        console.error(`WORKER: Crash at ${functionStep}:`, e);
        return { error: `Worker crash: ${e.message}`, results: dailyData };
    }
}

// --- Event Listener ---
self.onmessage = async (e) => {
    const { type, payload } = e.data;
    if (type === 'start') {
        try {
            const output = await performSimulation(payload);
            if (output.error && !output.results) {
                self.postMessage({ type: 'error', message: output.error });
            } else if (output.error) {
                self.postMessage({ type: 'error', message: output.error, results: output.results });
            } else {
                self.postMessage({ type: 'complete', results: output.results });
            }
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }
    }
};