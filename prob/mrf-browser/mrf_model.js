import { createMRFGraph } from './mrf_graph.js';

/**
 * MRFModel - High-level model abstraction for Markov Random Fields.
 * 
 * Manages string-based variable/level names and sparse factor specifications.
 * Builds a fresh MRFGraph on each inference call (no incremental updates).
 */
export class MRFModel {
    constructor() {
        /** @type {Map<string, {id: number, levels: Map<string, number>, levelsReverse: Map<number, string>}>} */
        this.variables = new Map();
        
        /** @type {Array<{type: 'unary', variable: string, entries: Map<string, number>}>} */
        this.unaryFactors = [];
        
        /** @type {Array<{type: 'binary', var1: string, var2: string, entries: Map<string, number>}>} */
        this.binaryFactors = [];
        
        /** @type {Map<string, string>} variableName -> levelName */
        this.evidence = new Map();
        
        this._nextId = 0;
        this._lastMarginals = null;
    }

    // ---- Variable Management ----

    /**
     * Registers a discrete variable.
     * @param {string} name - Unique variable name.
     * @param {string[]} levelNames - Array of level names for this variable.
     * @throws {Error} If variable name is duplicate or levels are invalid.
     */
    addVariable(name, levelNames) {
        if (this.variables.has(name)) {
            throw new Error(`Variable "${name}" already exists.`);
        }
        if (!name || name.trim() === '') {
            throw new Error('Variable name cannot be empty.');
        }
        if (!levelNames || levelNames.length === 0) {
            throw new Error(`Variable "${name}" must have at least one level.`);
        }

        // Check for duplicate level names
        const seen = new Set();
        for (const level of levelNames) {
            if (!level || level.trim() === '') {
                throw new Error(`Variable "${name}" has an empty level name.`);
            }
            if (seen.has(level)) {
                throw new Error(`Variable "${name}" has duplicate level "${level}".`);
            }
            seen.add(level);
        }

        const levels = new Map();
        const levelsReverse = new Map();
        levelNames.forEach((level, index) => {
            levels.set(level, index);
            levelsReverse.set(index, level);
        });

        this.variables.set(name, {
            id: this._nextId++,
            levels,
            levelsReverse
        });
    }

    /**
     * Removes a variable and all associated factors and evidence.
     * @param {string} name - Variable to remove.
     */
    removeVariable(name) {
        if (!this.variables.has(name)) return;

        this.variables.delete(name);

        // Remove associated unary factors
        this.unaryFactors = this.unaryFactors.filter(f => f.variable !== name);

        // Remove associated binary factors
        this.binaryFactors = this.binaryFactors.filter(f => f.var1 !== name && f.var2 !== name);

        // Remove evidence
        this.evidence.delete(name);
    }

    /**
     * Returns the dimension (number of levels) for a variable.
     * @param {string} name
     * @returns {number}
     */
    getDimension(name) {
        const v = this.variables.get(name);
        if (!v) throw new Error(`Variable "${name}" not found.`);
        return v.levels.size;
    }

    /**
     * Returns the level index for a variable and level name.
     * @param {string} varName
     * @param {string} levelName
     * @returns {number}
     */
    getLevelIndex(varName, levelName) {
        const v = this.variables.get(varName);
        if (!v) throw new Error(`Variable "${varName}" not found.`);
        const idx = v.levels.get(levelName);
        if (idx === undefined) throw new Error(`Level "${levelName}" not found in variable "${varName}".`);
        return idx;
    }

    // ---- Factor Management ----

    addUnaryFactor(variable, entries) {
        if (!this.variables.has(variable)) {
            throw new Error(`Variable "${variable}" not found.`);
        }
        this._validateUnaryEntries(variable, entries);

        const entryMap = new Map(Object.entries(entries));
        
        // Check if a factor already exists for this variable
        const existingIndex = this.unaryFactors.findIndex(f => f.variable === variable);
        if (existingIndex !== -1) {
            // Replace existing
            this.unaryFactors[existingIndex] = { type: 'unary', variable, entries: entryMap };
            return existingIndex;
        }
        
        // Add new
        this.unaryFactors.push({ type: 'unary', variable, entries: entryMap });
        return this.unaryFactors.length - 1;
    }

    addBinaryFactor(var1, var2, entries) {
        if (!this.variables.has(var1)) {
            throw new Error(`Variable "${var1}" not found.`);
        }
        if (!this.variables.has(var2)) {
            throw new Error(`Variable "${var2}" not found.`);
        }
        if (var1 === var2) {
            throw new Error('Cannot create a bivariate factor between a variable and itself.');
        }
        this._validateBinaryEntries(var1, var2, entries);

        const entryMap = new Map(Object.entries(entries));
        
        // Check if a factor already exists for this variable pair
        const existingIndex = this.binaryFactors.findIndex(
            f => (f.var1 === var1 && f.var2 === var2) || (f.var1 === var2 && f.var2 === var1)
        );
        if (existingIndex !== -1) {
            // Replace existing
            this.binaryFactors[existingIndex] = { type: 'binary', var1, var2, entries: entryMap };
            return existingIndex;
        }
        
        // Add new
        this.binaryFactors.push({ type: 'binary', var1, var2, entries: entryMap });
        return this.binaryFactors.length - 1;
    }

    /**
     * Removes a unary factor by index.
     * @param {number} index
     */
    removeUnaryFactor(index) {
        if (index >= 0 && index < this.unaryFactors.length) {
            this.unaryFactors.splice(index, 1);
        }
    }

    /**
     * Removes a binary factor by index.
     * @param {number} index
     */
    removeBinaryFactor(index) {
        if (index >= 0 && index < this.binaryFactors.length) {
            this.binaryFactors.splice(index, 1);
        }
    }

    // ---- Evidence Management ----

    /**
     * Sets evidence (observed value) for a variable.
     * @param {string} variable - Variable name.
     * @param {string} level - Observed level name.
     */
    setEvidence(variable, level) {
        if (!this.variables.has(variable)) {
            throw new Error(`Variable "${variable}" not found.`);
        }
        const idx = this.getLevelIndex(variable, level);
        this.evidence.set(variable, level);
    }

    /**
     * Clears evidence for a variable.
     * @param {string} variable
     */
    clearEvidence(variable) {
        this.evidence.delete(variable);
    }

    // ---- Inference ----

    /**
     * Runs belief propagation and returns marginals.
     * Builds a fresh MRFGraph each time.
     * 
     * @param {number} iterations - Number of BP iterations (default: 20).
     * @returns {Map<string, Map<string, number>>} variableName -> (levelName -> probability)
     */
    async infer(iterations = 20) {

        console.log("🚀 INFERENCE STARTED");
        console.log("Variables:", Array.from(this.variables.keys()));
        console.log("Unary Factors:", this.unaryFactors.length);
        console.log("Binary Factors:", this.binaryFactors.length);

        if (this.variables.size === 0) {
            throw new Error('No variables defined. Add at least one variable before inference.');
        }

        // Compute degree for each variable
        const degrees = this._computeDegrees();

        // Build the graph
        const graph = await createMRFGraph('./mrf.js');

        try {
            // 1. Create nodes
            const nodeIds = [];
            for (const [name, info] of this.variables) {
                const degree = degrees.get(name) || 0;
                if (degree === 0) {
                    throw new Error(
                        `Variable "${name}" has degree 0 (no bivariate factors). ` +
                        `Isolated variables are not supported. Connect it to at least one other variable.`
                    );
                }
                graph.addNode(info.id, degree, info.levels.size);
                nodeIds.push(info.id);
            }

            // 2. Create and connect unary factors
            // FIX: Ensure EVERY node has a prior, even if the user didn't specify one.
            for (const [name, info] of this.variables) {
                const dim = info.levels.size;
                
                // Check if the user defined a factor for this variable
                const userFactor = this.unaryFactors.find(f => f.variable === name);
                
                let dense;
                if (userFactor) {
                    // Use the user's sparse factor
                    dense = this._expandUnary(userFactor, dim);
                } else {
                    // AUTO-GENERATE: Uniform prior (all 1.0)
                    dense = new Array(dim).fill(1.0);
                    console.log(`ℹ️ Auto-generated uniform prior for ${name}`);
                }
                
                graph.setPrior(info.id, dense);
            }

            // 3. Create and connect binary factors
            for (const factor of this.binaryFactors) {
                const info1 = this.variables.get(factor.var1);
                const info2 = this.variables.get(factor.var2);
                const dim1 = info1.levels.size;
                const dim2 = info2.levels.size;
                const dense = this._expandBinary(factor, info1, info2);
                graph.addEdge(info1.id, info2.id, dense);
            }

            // 4. Set evidence
            for (const [varName, levelName] of this.evidence) {
                const info = this.variables.get(varName);
                const levelIdx = info.levels.get(levelName);
                graph.setEvidence(info.id, levelIdx);
            }

            // 5. Run BP
            graph.runBeliefPropagation(nodeIds, iterations);

            // 6. Extract marginals
            const marginals = new Map();
            for (const [name, info] of this.variables) {
                const probs = graph.getMarginal(info.id);
                const levelProbs = new Map();
                for (let i = 0; i < probs.length; i++) {
                    const levelName = info.levelsReverse.get(i);
                    levelProbs.set(levelName, probs[i]);
                }
                marginals.set(name, levelProbs);
            }

            this._lastMarginals = marginals;
            return marginals;

        } finally {
            graph.destroy();
        }
    }

    /**
     * Returns the most recent marginal results (without re-running inference).
     * @returns {Map<string, Map<string, number>>|null}
     */
    getMarginals() {
        return this._lastMarginals;
    }

    // ---- Private Helpers ----

    /**
     * Computes the degree (number of bivariate factor connections) for each variable.
     */
    _computeDegrees() {
        const degrees = new Map();
        for (const name of this.variables.keys()) {
            degrees.set(name, 0);
        }
        for (const factor of this.binaryFactors) {
            degrees.set(factor.var1, (degrees.get(factor.var1) || 0) + 1);
            degrees.set(factor.var2, (degrees.get(factor.var2) || 0) + 1);
        }
        return degrees;
    }

    /**
     * Expands a sparse unary factor into a dense array.
     * Unspecified levels default to 1.0.
     */
    _expandUnary(factor, dim) {
        const dense = new Array(dim).fill(1.0);
        for (const [levelName, value] of factor.entries) {
            const info = this.variables.get(factor.variable);
            const idx = info.levels.get(levelName);
            dense[idx] = value;
        }
        return dense;
    }

    /**
     * Expands a sparse binary factor into a dense row-major array.
     * Unspecified pairs default to 1.0.
     */
    _expandBinary(factor, info1, info2) {
        const dim1 = info1.levels.size;
        const dim2 = info2.levels.size;
        const dense = new Array(dim1 * dim2).fill(1.0);

        for (const [key, value] of factor.entries) {
            // Key format: "level1,level2"
            const parts = key.split(',');
            if (parts.length !== 2) {
                throw new Error(`Invalid binary factor entry key: "${key}". Expected "level1,level2".`);
            }
            const level1 = parts[0].trim();
            const level2 = parts[1].trim();

            const row = info1.levels.get(level1);
            const col = info2.levels.get(level2);

            if (row === undefined) {
                throw new Error(`Level "${level1}" not found in variable "${factor.var1}".`);
            }
            if (col === undefined) {
                throw new Error(`Level "${level2}" not found in variable "${factor.var2}".`);
            }

            dense[row * dim2 + col] = value;
        }

        return dense;
    }

    /**
     * Validates that all level names in a unary factor entry exist.
     */
    _validateUnaryEntries(variable, entries) {
        const info = this.variables.get(variable);
        for (const [levelName, value] of Object.entries(entries)) {
            if (!info.levels.has(levelName)) {
                throw new Error(`Level "${levelName}" not found in variable "${variable}".`);
            }
            if (typeof value !== 'number' || value < 0) {
                throw new Error(`Value for "${levelName}" must be a non-negative number, got "${value}".`);
            }
        }
    }

    /**
     * Validates that all level names in a binary factor entry exist.
     */
    _validateBinaryEntries(var1, var2, entries) {
        const info1 = this.variables.get(var1);
        const info2 = this.variables.get(var2);
        for (const [key, value] of Object.entries(entries)) {
            const parts = key.split(',');
            if (parts.length !== 2) {
                throw new Error(`Invalid binary factor entry key: "${key}". Expected "level1,level2".`);
            }
            const level1 = parts[0].trim();
            const level2 = parts[1].trim();

            if (!info1.levels.has(level1)) {
                throw new Error(`Level "${level1}" not found in variable "${var1}".`);
            }
            if (!info2.levels.has(level2)) {
                throw new Error(`Level "${level2}" not found in variable "${var2}".`);
            }
            if (typeof value !== 'number' || value < 0) {
                throw new Error(`Value for "${key}" must be a non-negative number, got "${value}".`);
            }
        }
    }

    /**
     * Resets the entire model.
     */
    reset() {
        this.variables.clear();
        this.unaryFactors = [];
        this.binaryFactors = [];
        this.evidence.clear();
        this._nextId = 0;
        this._lastMarginals = null;
    }
}