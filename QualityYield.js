/**
 * Quality Yield Module
 * This module calculates a *stress breakdown* based on four factors.
 */

// The only global adjustable parameter. Defaults to 15%.
window.stDevPercentage = 0.15;

/**
 * --- WageManager (Background Service) ---
 * Handles async fetching of wage data.
 */
const WageManager = (() => {
    let _currentStress = 0;
    let _currentMedianHourly = 0;
    let _lastParams = { lat: null, lon: null, cost: null };

    // State Tracking
    let _isWarm = false;

    // Stats Storage: "StrategyName:Type" -> { attempts, successes, totalMs }
    const _stats = {};

    const STRATEGIES = [
        {
            name: 'Direct',
            urlFn: (target) => target
        },
        {
            name: 'CorsProxy',
            urlFn: (target) => `https://corsproxy.io/?${encodeURIComponent(target)}`
        },
        {
            name: 'AllOrigins',
            urlFn: (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`
        }
    ];

    // --- SCORING SYSTEM ---
    function updateStats(key, success, duration) {
        if (!_stats[key]) _stats[key] = { attempts: 0, successes: 0, totalMs: 0 };
        _stats[key].attempts++;
        if (success) _stats[key].successes++;
        _stats[key].totalMs += duration;
    }

    function getScore(candidate) {
        const key = `${candidate.strategy.name}:${candidate.type}`;
        const s = _stats[key];

        // Boost untried strategies so they get a chance in Cold Start
        if (!s || s.attempts === 0) return 50000;

        const successRate = s.successes / s.attempts;
        const avgTime = s.totalMs / s.successes || 2000;

        // 1. Reliability (Heavy Weight)
        let score = successRate * 100000;

        // 2. Speed (Moderate Weight)
        score += (500000 / (avgTime + 100));

        // 3. Precision (Slight Weight): Tract > County
        if (candidate.type === 'Tract') {
            score += 5000;
        }

        return score;
    }

    // --- HELPER: Single Fetch ---
    const fetchCandidate = (candidate, signal, validator) => {
        return new Promise((resolve, reject) => {
            const finalUrl = candidate.strategy.urlFn(candidate.url);

            fetch(finalUrl, { signal })
                .then(res => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return res.json();
                })
                .then(json => {
                    const validData = validator(json);
                    if (validData !== null) {
                        resolve(validData);
                    } else {
                        reject(new Error("Invalid Data"));
                    }
                })
                .catch(err => reject(err));
        });
    };

    // --- HELPER: Race Logic (Abort Losers) ---
    async function raceStrategies(candidates, validator) {
        const controller = new AbortController();

        const promises = candidates.map(cand => {
            const key = `${cand.strategy.name}:${cand.type}`;
            const start = performance.now();

            return fetchCandidate(cand, controller.signal, validator)
                .then(result => {
                    updateStats(key, true, performance.now() - start);
                    return result;
                })
                .catch(err => {
                    if (err.name !== 'AbortError') {
                        updateStats(key, false, performance.now() - start);
                    }
                    throw err;
                });
        });

        try {
            const winner = await Promise.any(promises);
            controller.abort();
            return winner;
        } catch (e) {
            controller.abort();
            return null;
        }
    }

    // --- HELPER: Execution Engine ---
    async function executeAdaptive(candidates, validator) {
        if (!candidates || candidates.length === 0) return null;

        // 1. WARM MODE: Race Top 2
        if (_isWarm) {
            // Sort candidates by dynamic score
            const sorted = [...candidates].sort((a, b) => getScore(b) - getScore(a));

            const topTier = sorted.slice(0, 2);
            const bottomTier = sorted.slice(2);

            // Race the Top 2
            const topResult = await raceStrategies(topTier, validator);
            if (topResult !== null) return topResult;

            // If Top 2 fail, race the rest
            if (bottomTier.length > 0) {
                return await raceStrategies(bottomTier, validator);
            }
            return null;
        }

        // 2. COLD START: Shotgun (Race All with 2s Limit)
        const COLD_TIMEOUT = 2000;

        const promises = candidates.map(async (cand) => {
            const key = `${cand.strategy.name}:${cand.type}`;
            const start = performance.now();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), COLD_TIMEOUT);

            try {
                const result = await fetchCandidate(cand, controller.signal, validator);
                clearTimeout(timeoutId);

                updateStats(key, true, performance.now() - start);
                return { candidate: cand, result, dur: performance.now() - start };
            } catch (e) {
                clearTimeout(timeoutId);
                // We record this as a failure to penalize slow/broken strategies
                updateStats(key, false, performance.now() - start);
                return null;
            }
        });

        const results = await Promise.allSettled(promises);

        const successes = results
            .filter(r => r.status === 'fulfilled' && r.value !== null)
            .map(r => r.value);

        if (successes.length > 0) {
            _isWarm = true;

            // Return best result based on priority (Tract > Speed)
            successes.sort((a, b) => {
                const scoreA = getScore(a.candidate);
                const scoreB = getScore(b.candidate);
                return scoreB - scoreA;
            });
            return successes[0].result;
        }

        return null;
    }

    // --- API: Step 1 - Get FIPS ---
    async function fetchFipsFromLatLon(lat, lon) {
        const targetUrl = `https://geo.fcc.gov/api/census/block/find?format=json&latitude=${lat}&longitude=${lon}&showall=true`;

        const validator = (json) => {
            const blockFIPS = (json.Block && json.Block.FIPS) ? json.Block.FIPS : null;
            if (blockFIPS) {
                return {
                    stateFips: (json.State && json.State.FIPS) ? json.State.FIPS : null,
                    countyFips: (json.County && json.County.FIPS) ? json.County.FIPS : null,
                    tract: blockFIPS.substring(0, 11),
                };
            }
            return null;
        };

        const candidates = STRATEGIES.map(s => ({
            strategy: s,
            url: targetUrl,
            type: 'FIPS'
        }));

        return await executeAdaptive(candidates, validator);
    }

    // --- API: Step 2 - Get Wage Data ---
    async function fetchMedianHouseholdIncome({ stateFips, countyFips, tract }, censusApiKey = '') {
        const year = '2021';
        const varName = 'B19013_001E';
        const commonKey = censusApiKey ? `&key=${encodeURIComponent(censusApiKey)}` : '';

        const validator = (json) => {
            if (json && Array.isArray(json) && json.length >= 2) {
                const val = Number(json[1][0]);
                if (!isNaN(val) && val > 0) return val;
            }
            return null;
        };

        const buildUrl = (forParam, inParam) => {
            return `https://api.census.gov/data/${year}/acs/acs5?get=${varName}&for=${forParam}&in=${inParam}${commonKey}`;
        };

        const candidates = [];

        // A. Tract Candidates
        if (stateFips && countyFips && tract) {
            const countyCode = countyFips.slice(-3);
            const tractCode = tract.substring(5, 11);
            const tractUrl = buildUrl(`tract:${tractCode}`, `state:${stateFips}+county:${countyCode}`);

            STRATEGIES.forEach(s => candidates.push({ strategy: s, url: tractUrl, type: 'Tract' }));
        }

        // B. County Candidates
        if (stateFips && countyFips) {
            const countyCode = countyFips.slice(-3);
            const countyUrl = buildUrl(`county:${countyCode}`, `state:${stateFips}`);

            STRATEGIES.forEach(s => candidates.push({ strategy: s, url: countyUrl, type: 'County' }));
        }

        return await executeAdaptive(candidates, validator);
    }

    function mapWageToStress(medianHourly, setLaborCost) {
        if (!medianHourly || medianHourly <= 0) return 0;
        if (setLaborCost >= medianHourly) return 0;
        const lowBound = medianHourly * 0.6;
        if (setLaborCost <= lowBound) return 1;
        return (medianHourly - setLaborCost) / (medianHourly - lowBound);
    }

    // --- PUBLIC METHODS ---

    async function update(lat, lon, laborCost) {
        // Cache Check
        if (_lastParams.lat === lat && _lastParams.lon === lon && _lastParams.cost === laborCost && _currentMedianHourly > 0) {
            return { medianHourly: _currentMedianHourly, stress: _currentStress };
        }

        // Fetch Logic
        let newMedianHourly = 0;

        if (lat !== _lastParams.lat || lon !== _lastParams.lon) {
            const fips = await fetchFipsFromLatLon(lat, lon);
            if (fips) {
                const income = await fetchMedianHouseholdIncome(fips);
                if (income) {
                    newMedianHourly = income / (52 * 40);
                }
            }
        } else {
            newMedianHourly = _currentMedianHourly;
        }

        // State Update (Persistence Logic)
        if (newMedianHourly > 0) {
            _currentMedianHourly = newMedianHourly;
            _currentStress = mapWageToStress(newMedianHourly, laborCost);
        } else {
            // Failure: Keep old wage if available.
            if (_currentMedianHourly > 0) {
                // Recalculate stress using OLD wage and NEW labor cost
                _currentStress = mapWageToStress(_currentMedianHourly, laborCost);
            } else {
                _currentStress = 0;
            }
        }

        _lastParams = { lat, lon, cost: laborCost };

        return { medianHourly: _currentMedianHourly, stress: _currentStress };
    }

    return {
        update,
        getStress: () => _currentStress,
        getMedianHourly: () => _currentMedianHourly
    };
})();

// Expose WageManager to other tabs
window.WageManager = WageManager;

/**
 * Helper function to calculate the probabilistic details
 * for a single model type within a single workstation.
 */
function getModelProbabilistics(elementTimes, taktTime, stDevPercentage) {
    if (!elementTimes || elementTimes.length === 0) {
        return { mean: 0, stdDev: 0, probOverage: 0 };
    }

    // Calculate the mean total time for this model
    const mean = elementTimes.reduce((sum, t) => sum + t, 0);

    // Calculate the total workstation stDev for this model
    const variance = elementTimes.reduce((sum, t) => {
        const taskStDev = t * stDevPercentage;
        const taskVariance = taskStDev * taskStDev;
        return sum + taskVariance;
    }, 0);
    const stdDev = Math.sqrt(variance);

    // Calculate probability of exceeding takt time
    let probOverage = 0.0;
    if (!isFinite(stdDev) || stdDev <= 0) {
        // No variability, stress is 0 unless the mean is already over takt.
        probOverage = (mean > taktTime) ? 1.0 : 0.0;
    } else {
        const z = (taktTime - mean) / stdDev;
        probOverage = 1 - normalCDF(z);
    }

    return {
        mean: mean,
        stdDev: stdDev,
        probOverage: Math.min(1, Math.max(0, probOverage))
    };
}

/**
 * Defines the transition probabilities P(j | i)
 * P(Next Model | Current Model)
 */
const transitionProbs = {
    super: { super: 0.0, ultra: 0.7143, mega: 0.2857 },
    ultra: { super: 0.5618, ultra: 0.2135, mega: 0.2247 },
    mega: { super: 0.50, ultra: 0.0, mega: 0.50 }
};


/**
 * Calculates the average workstation stress across the entire line.
 * It iterates through each workstation and finds the weighted-average stress
 * based on the new "failure to compensate" logic.
 */
function calculateWorkstationStress(workstationDetails, taktTime, stDevPercentage, buildRatios) {
    if (!workstationDetails || workstationDetails.length === 0 || !taktTime || taktTime <= 0 || !buildRatios) {
        return 0;
    }

    let totalStress = 0;
    let workstationCount = 0;
    const modelKeys = ['super', 'ultra', 'mega'];

    for (let i = 0; i < workstationDetails.length; i++) {
        const ws = workstationDetails[i];

        // 1. Get probabilistics for each model
        const p = {
            super: getModelProbabilistics(ws.superElementTimes, taktTime, stDevPercentage),
            ultra: getModelProbabilistics(ws.ultraElementTimes, taktTime, stDevPercentage),
            mega: getModelProbabilistics(ws.megaElementTimes, taktTime, stDevPercentage)
        };

        // 2. Calculate P(Failure | given current model 'i')
        let pFailGiven = { super: 0, ultra: 0, mega: 0 };

        for (const i_key of modelKeys) {
            const prob_i_overruns = p[i_key].probOverage;

            // If the current model never overruns, it can't cause this type of failure
            if (prob_i_overruns === 0) {
                pFailGiven[i_key] = 0;
                continue;
            }

            let pNextFailsToCompensate = 0;

            for (const j_key of modelKeys) {
                const prob_i_to_j = transitionProbs[i_key][j_key];
                if (prob_i_to_j === 0) continue;

                const model_j = p[j_key];

                // We need P(j doesn't underrun by Overage_i), this is the "compensation takt time" j must beat.
                // Approx: P(Time_j > Takt - (Mean_i - Takt)) = P(Time_j > 2*Takt - Mean_i)
                const compensationTakt = 2 * taktTime - p[i_key].mean;

                let p_j_fails_comp = 0.0;
                if (!isFinite(model_j.stdDev) || model_j.stdDev <= 0) {
                    p_j_fails_comp = (model_j.mean > compensationTakt) ? 1.0 : 0.0;
                } else {
                    const z_comp = (compensationTakt - model_j.mean) / model_j.stdDev;
                    // P(Time_j > compensationTakt)
                    p_j_fails_comp = 1 - normalCDF(z_comp);
                }

                // Add this to the weighted sum for the 'i' model
                pNextFailsToCompensate += p_j_fails_comp * prob_i_to_j;
            }

            // P(Failure | i) = P(i overruns) * P(Next fails to compensate | i)
            pFailGiven[i_key] = prob_i_overruns * pNextFailsToCompensate;
        }

        // 3. Calculate total workstation stress using buildRatios (stationary distribution)
        // P(Stress) = P(Super) * P(Fail | Super) + P(Ultra) * P(Fail | Ultra) + P(Mega) * P(Fail | Mega)
        const workstationStress = (buildRatios.super * pFailGiven.super) +
            (buildRatios.ultra * pFailGiven.ultra) +
            (buildRatios.mega * pFailGiven.mega);

        totalStress += workstationStress;
        workstationCount++;
    }

    const averageStress = workstationCount > 0 ? totalStress / workstationCount : 0;
    return averageStress;
}

/**
 * Approximation of the cumulative distribution function for standard normal distribution.
 */
function normalCDF(z) {
    if (!isFinite(z)) {
        return z > 0 ? 1 : 0;
    }
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    const result = z > 0 ? 1 - p : p;
    return Math.max(0, Math.min(1, result));
}

/**
 * Calculates the quality loss (stress) from all factors and returns a breakdown.
 *
 * @param {number} stDevPercentage - Standard deviation as a percentage of mean (e.g., 0.1)
 * @param {number} conveyorSpeed - Conveyor speed in ft/min
 * @param {Array} workstationDetails - Array of workstation objects
 * @param {number} taktTime - Required takt time in minutes
 * @param {number} overtimeStress - Overtime stress factor (0-1)
 * @param {number} wageStress - Local wage stress factor (0-1)
 * @param {Object} buildRatios - The {super: 0.35, ultra: 0.45, mega: 0.20} object
 * @returns {Object} A breakdown of quality loss.
 */
function calculateQualityStressBreakdown(stDevPercentage, conveyorSpeed, workstationDetails, taktTime, overtimeStress, wageStress, buildRatios) {
    const MAX_CONVEYOR_SPEED = 15;

    // --- Input Validation ---
    if (!isFinite(stDevPercentage) || stDevPercentage < 0) { stDevPercentage = 0; }
    if (!isFinite(conveyorSpeed) || conveyorSpeed < 0) { conveyorSpeed = 10; }
    if (!isFinite(taktTime) || taktTime <= 0) { taktTime = 2.5; }
    overtimeStress = isFinite(overtimeStress) ? Math.max(0, Math.min(1, overtimeStress)) : 0;
    wageStress = isFinite(wageStress) ? Math.max(0, Math.min(1, wageStress)) : 0;

    // --- Calculate individual stress factors ---

    // Workstation Stress (Probabilistic, State-Based)
    const workstationStress = calculateWorkstationStress(workstationDetails, taktTime, stDevPercentage, buildRatios);

    // Conveyor Fatigue (Probabilistic)
    let conveyorFatigue = 0;
    const speedStDev = conveyorSpeed * stDevPercentage;
    let z_speed = Infinity;

    if (speedStDev > 0) {
        z_speed = (MAX_CONVEYOR_SPEED - conveyorSpeed) / speedStDev;
        conveyorFatigue = 1 - normalCDF(z_speed);
    } else if (conveyorSpeed > MAX_CONVEYOR_SPEED) {
        conveyorFatigue = 1;
    }

    // Overtime Stress (from Location tab)
    const overtimeStressFactor = overtimeStress || 0;

    // Wage Stress (from Location tab)
    const wageStressFactor = wageStress || 0;

    // --- Calculate Weighted Loss Breakdown ---
    const breakdown = {
        workstationLoss: 0.4 * workstationStress,
        conveyorLoss: 0.2 * conveyorFatigue,
        overtimeLoss: 0.2 * overtimeStressFactor,
        wageLoss: 0.2 * wageStressFactor
    };

    // Calculate total stress (sum of losses)
    breakdown.totalStress = breakdown.workstationLoss +
        breakdown.conveyorLoss +
        breakdown.overtimeLoss +
        breakdown.wageLoss;
    breakdown.totalStress = Math.min(1.0, breakdown.totalStress);

    return breakdown;
}

// Make the functions globally available
window.calculateQualityStressBreakdown = calculateQualityStressBreakdown;