import { MRFModel } from './mrf_model.js';

// ---- State ----
const model = new MRFModel();
let wasmLoaded = false;

// ---- DOM Elements ----
const els = {
    // Variables
    varName: document.getElementById('var-name'),
    varLevels: document.getElementById('var-levels'),
    btnAddVar: document.getElementById('btn-add-var'),
    varList: document.getElementById('var-list'),
    errorVar: document.getElementById('error-var'),

    // Factors
    factorType: document.getElementById('factor-type'),
    unaryForm: document.getElementById('unary-form'),
    binaryForm: document.getElementById('binary-form'),
    unaryVar: document.getElementById('unary-var'),
    unaryEntries: document.getElementById('unary-entries'),
    btnAddUnary: document.getElementById('btn-add-unary'),
    binaryVar1: document.getElementById('binary-var1'),
    binaryVar2: document.getElementById('binary-var2'),
    binaryEntries: document.getElementById('binary-entries'),
    btnAddBinary: document.getElementById('btn-add-binary'),
    factorList: document.getElementById('factor-list'),
    errorFactor: document.getElementById('error-factor'),

    // Evidence
    evidenceVar: document.getElementById('evidence-var'),
    evidenceLevel: document.getElementById('evidence-level'),
    btnSetEvidence: document.getElementById('btn-set-evidence'),
    evidenceList: document.getElementById('evidence-list'),
    errorEvidence: document.getElementById('error-evidence'),

    // Controls
    iterations: document.getElementById('iterations'),
    btnInfer: document.getElementById('btn-infer'),
    btnReset: document.getElementById('btn-reset'),
    loading: document.getElementById('loading'),

    // Results
    resultsContainer: document.getElementById('results-container')
};

// ---- Initialization ----

async function init() {
    // Set up UI immediately
    updateAllDropdowns();
    renderVariables();
    renderFactors();
    renderEvidence();
    setupEventListeners();

    // Pre-load WASM module in the background
    try {
        const { default: createMRFModule } = await import('./mrf.js');
        await createMRFModule();
        wasmLoaded = true;
        els.loading.classList.add('hidden');
    } catch (err) {
        console.error('Failed to preload WASM:', err);
        els.loading.textContent = 'WASM pre-load failed. Will retry on first inference.';
        // Don't block the UI — inference will attempt to load again
    }
}

// ---- Event Listeners ----

function setupEventListeners() {
    // Variables
    els.btnAddVar.addEventListener('click', handleAddVariable);
    
    // Factors
    els.factorType.addEventListener('change', toggleFactorForm);
    els.btnAddUnary.addEventListener('click', handleAddUnaryFactor);
    els.btnAddBinary.addEventListener('click', handleAddBinaryFactor);
    
    // Evidence
    els.btnSetEvidence.addEventListener('click', handleSetEvidence);
    
    // Controls
    els.btnInfer.addEventListener('click', handleInference);
    els.btnReset.addEventListener('click', handleReset);
}

// ---- Variable Management ----

function handleAddVariable() {
    clearError(els.errorVar);
    
    const name = els.varName.value.trim();
    const levelsStr = els.varLevels.value.trim();
    
    if (!name) {
        showError(els.errorVar, 'Variable name is required.');
        return;
    }
    
    if (!levelsStr) {
        showError(els.errorVar, 'At least one level is required.');
        return;
    }
    
    const levels = levelsStr.split(',').map(l => l.trim()).filter(l => l);
    
    if (levels.length === 0) {
        showError(els.errorVar, 'No valid levels found.');
        return;
    }
    
    try {
        model.addVariable(name, levels);
        els.varName.value = '';
        els.varLevels.value = '';
        renderVariables();
        updateAllDropdowns();
    } catch (err) {
        showError(els.errorVar, err.message);
    }
}

function renderVariables() {
    els.varList.innerHTML = '';
    
    for (const [name, info] of model.variables) {
        const li = document.createElement('li');
        const levelNames = Array.from(info.levels.keys()).join(', ');
        li.innerHTML = `
            <span class="item-info"><strong>${name}</strong>: ${levelNames}</span>
            <button class="btn btn-danger btn-small btn-remove" data-action="remove-var" data-id="${name}">✕</button>
        `;
        els.varList.appendChild(li);
    }
    
    // Attach event listeners to remove buttons
    els.varList.querySelectorAll('.btn-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.dataset.id;
            model.removeVariable(id);
            renderVariables();
            renderFactors();
            renderEvidence();
            updateAllDropdowns();
        });
    });
}

// ---- Factor Management ----

function toggleFactorForm() {
    const type = els.factorType.value;
    if (type === 'unary') {
        els.unaryForm.classList.remove('hidden');
        els.binaryForm.classList.add('hidden');
    } else {
        els.unaryForm.classList.add('hidden');
        els.binaryForm.classList.remove('hidden');
    }
}

function handleAddUnaryFactor() {
    clearError(els.errorFactor);
    
    const varName = els.unaryVar.value;
    const entriesStr = els.unaryEntries.value.trim();
    
    if (!varName) {
        showError(els.errorFactor, 'Select a variable.');
        return;
    }
    
    if (!entriesStr) {
        showError(els.errorFactor, 'Enter factor entries (e.g., rainy=5, sunny=2).');
        return;
    }
    
    const entries = parseSparseEntries(entriesStr, 'unary');
    if (!entries) return;
    
    try {
        model.addUnaryFactor(varName, entries);
        els.unaryEntries.value = '';
        renderFactors();
    } catch (err) {
        showError(els.errorFactor, err.message);
    }
}

function handleAddBinaryFactor() {
    clearError(els.errorFactor);
    
    const var1 = els.binaryVar1.value;
    const var2 = els.binaryVar2.value;
    const entriesStr = els.binaryEntries.value.trim();
    
    if (!var1 || !var2) {
        showError(els.errorFactor, 'Select both variables.');
        return;
    }
    
    if (var1 === var2) {
        showError(els.errorFactor, 'Cannot create a factor between a variable and itself.');
        return;
    }
    
    if (!entriesStr) {
        showError(els.errorFactor, 'Enter factor entries (e.g., rainy,sad=3).');
        return;
    }
    
    const entries = parseSparseEntries(entriesStr, 'binary');
    if (!entries) return;
    
    try {
        model.addBinaryFactor(var1, var2, entries);
        els.binaryEntries.value = '';
        renderFactors();
    } catch (err) {
        showError(els.errorFactor, err.message);
    }
}

function renderFactors() {
    els.factorList.innerHTML = '';
    
    // Render unary factors
    model.unaryFactors.forEach((factor, index) => {
        const li = document.createElement('li');
        const entriesStr = Array.from(factor.entries.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
        li.innerHTML = `
            <span class="item-info">Unary: <strong>${factor.variable}</strong> → ${entriesStr}</span>
            <button class="btn btn-danger btn-small btn-remove" data-action="remove-unary" data-index="${index}">✕</button>
        `;
        els.factorList.appendChild(li);
    });
    
    // Render binary factors
    model.binaryFactors.forEach((factor, index) => {
        const li = document.createElement('li');
        const entriesStr = Array.from(factor.entries.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
        li.innerHTML = `
            <span class="item-info">Binary: <strong>${factor.var1}</strong>, <strong>${factor.var2}</strong> → ${entriesStr}</span>
            <button class="btn btn-danger btn-small btn-remove" data-action="remove-binary" data-index="${index}">✕</button>
        `;
        els.factorList.appendChild(li);
    });
    
    // Attach event listeners
    els.factorList.querySelectorAll('.btn-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            const index = parseInt(e.target.dataset.index);
            
            if (action === 'remove-unary') {
                model.removeUnaryFactor(index);
            } else if (action === 'remove-binary') {
                model.removeBinaryFactor(index);
            }
            
            renderFactors();
        });
    });
}

// ---- Evidence Management ----

function handleSetEvidence() {
    clearError(els.errorEvidence);
    
    const varName = els.evidenceVar.value;
    const levelName = els.evidenceLevel.value;
    
    if (!varName || !levelName) {
        showError(els.errorEvidence, 'Select both variable and level.');
        return;
    }
    
    try {
        model.setEvidence(varName, levelName);
        renderEvidence();
    } catch (err) {
        showError(els.errorEvidence, err.message);
    }
}

function renderEvidence() {
    els.evidenceList.innerHTML = '';
    
    for (const [varName, levelName] of model.evidence) {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="item-info"><strong>${varName}</strong> = ${levelName}</span>
            <button class="btn btn-danger btn-small btn-remove" data-action="remove-evidence" data-var="${varName}">✕</button>
        `;
        els.evidenceList.appendChild(li);
    }
    
    // Attach event listeners
    els.evidenceList.querySelectorAll('.btn-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const varName = e.target.dataset.var;
            model.clearEvidence(varName);
            renderEvidence();
        });
    });
}

// ---- Inference ----

async function handleInference() {
    if (!wasmLoaded) {
        alert('WASM module is still loading. Please wait...');
        return;
    }
    
    const iterations = parseInt(els.iterations.value) || 20;
    
    els.btnInfer.disabled = true;
    els.loading.textContent = 'Running inference...';
    els.loading.classList.remove('hidden');
    els.resultsContainer.innerHTML = '';
    
    try {
        const marginals = await model.infer(iterations);
        renderResults(marginals);
    } catch (err) {
        els.resultsContainer.innerHTML = `<div class="error-message" style="padding: 10px;">Inference failed: ${err.message}</div>`;
    } finally {
        els.btnInfer.disabled = false;
        els.loading.classList.add('hidden');
    }
}

function renderResults(marginals) {
    els.resultsContainer.innerHTML = '';
    
    for (const [varName, levelProbs] of marginals) {
        const varDiv = document.createElement('div');
        varDiv.className = 'result-variable';
        
        const title = document.createElement('h3');
        title.textContent = varName;
        varDiv.appendChild(title);
        
        // Sort levels by probability descending
        const sortedLevels = Array.from(levelProbs.entries())
            .sort((a, b) => b[1] - a[1]);
        
        for (const [levelName, prob] of sortedLevels) {
            const row = document.createElement('div');
            row.className = 'result-level';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'level-name';
            nameSpan.textContent = levelName;
            
            const barContainer = document.createElement('div');
            barContainer.className = 'bar-container';
            
            const barFill = document.createElement('div');
            barFill.className = 'bar-fill';
            barFill.style.width = `${prob * 100}%`;
            
            const probSpan = document.createElement('span');
            probSpan.className = 'probability';
            probSpan.textContent = prob.toFixed(4);
            
            barContainer.appendChild(barFill);
            row.appendChild(nameSpan);
            row.appendChild(barContainer);
            row.appendChild(probSpan);
            varDiv.appendChild(row);
        }
        
        els.resultsContainer.appendChild(varDiv);
    }
}

// ---- Utilities ----

function updateAllDropdowns() {
    const vars = Array.from(model.variables.keys());
    
    // Update all variable selects
    const selects = [els.unaryVar, els.binaryVar1, els.binaryVar2, els.evidenceVar];
    selects.forEach(sel => {
        const currentVal = sel.value;
        sel.innerHTML = '<option value="">-- Select --</option>';
        vars.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            sel.appendChild(opt);
        });
        // Restore selection if possible
        if (vars.includes(currentVal)) sel.value = currentVal;
    });
    
    // Update level dropdown based on selected variable
    updateLevelDropdown();
    
    // Listen for variable changes to update levels
    els.evidenceVar.addEventListener('change', updateLevelDropdown);
}

function updateLevelDropdown() {
    const varName = els.evidenceVar.value;
    els.evidenceLevel.innerHTML = '<option value="">-- Select Level --</option>';
    
    if (varName && model.variables.has(varName)) {
        const info = model.variables.get(varName);
        Array.from(info.levels.keys()).forEach(level => {
            const opt = document.createElement('option');
            opt.value = level;
            opt.textContent = level;
            els.evidenceLevel.appendChild(opt);
        });
    }
}

function parseSparseEntries(str, type) {
    const entries = {};

    if (type === 'unary') {
        // Unary: split on comma, each piece is "level=value"
        const pairs = str.split(',');
        for (const pair of pairs) {
            const trimmed = pair.trim();
            if (!trimmed) continue;

            const parts = trimmed.split('=');
            if (parts.length !== 2) {
                showError(els.errorFactor, `Invalid entry format: "${trimmed}". Expected "level=value".`);
                return null;
            }
            const key = parts[0].trim();
            const value = parseFloat(parts[1].trim());

            if (isNaN(value) || value < 0) {
                showError(els.errorFactor, `Invalid value for "${key}": must be a non-negative number.`);
                return null;
            }
            entries[key] = value;
        }
    } else {
        // Binary: use regex to match "level1,level2=value" patterns
        // This avoids the ambiguity of comma as both entry separator and level separator
        const regex = /([^,=]+)\s*,\s*([^,=]+)\s*=\s*([\d.eE+-]+)/g;
        let match;
        let matchCount = 0;

        while ((match = regex.exec(str)) !== null) {
            matchCount++;
            const level1 = match[1].trim();
            const level2 = match[2].trim();
            const value = parseFloat(match[3].trim());
            const key = `${level1},${level2}`;

            if (isNaN(value) || value < 0) {
                showError(els.errorFactor, `Invalid value for "${key}": must be a non-negative number.`);
                return null;
            }
            entries[key] = value;
        }

        if (matchCount === 0) {
            showError(els.errorFactor, 'No valid entries found. Expected format: "level1,level2=value, ...".');
            return null;
        }
    }

    if (Object.keys(entries).length === 0) {
        showError(els.errorFactor, 'No valid entries found.');
        return null;
    }

    return entries;
}

function showError(el, message) {
    el.textContent = message;
    el.style.display = 'block';
}

function clearError(el) {
    el.textContent = '';
    el.style.display = 'none';
}

function handleReset() {
    if (!confirm('Are you sure you want to clear all variables, factors, and evidence?')) return;
    
    model.reset();
    els.varName.value = '';
    els.varLevels.value = '';
    els.unaryEntries.value = '';
    els.binaryEntries.value = '';
    els.evidenceLevel.value = '';
    els.resultsContainer.innerHTML = '';
    
    renderVariables();
    renderFactors();
    renderEvidence();
    updateAllDropdowns();
}

// Start the app
init();