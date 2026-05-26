/**
 * MRFGraph - JavaScript wrapper for the C MRF library via Emscripten.
 * Pointers are stored as plain numbers (uintptr_t).
 */
export class MRFGraph {
    constructor(module) {
        this.Module = module;
        this.nodes = new Map();       // Map<id, uintptr_t>
        this.factors = new Map();     // Map<uniqueId, {ptr: uintptr_t, type: string}>
        this.nextFactorId = 0;
        this.isDestroyed = false;
    }

    addNode(id, degree, dimension) {
        if (this.isDestroyed) throw new Error("Graph is destroyed.");
        if (this.nodes.has(id)) throw new Error(`Node ${id} already exists.`);

        const ptr = this.Module.new_node(id, degree, dimension);
        this.Module._register_node(id, ptr);
        this.nodes.set(id, ptr);
        return id;
    }

    setPrior(nodeId, values) {
        const nodePtr = this._getNodePtr(nodeId);
        const dim = values.length;
        const factorPtr = this.Module.new_factor1d(dim);

        for (let i = 0; i < dim; i++) {
            this.Module.set_factor1d_at(factorPtr, i, values[i]);
        }

        this.Module.connect_factor1d(nodePtr, factorPtr);

        const factorId = `prior_${nodeId}`;
        this.factors.set(factorId, { ptr: factorPtr, type: 'factor1d' });
    }

    addEdge(node1Id, node2Id, values) {
        const n1Ptr = this._getNodePtr(node1Id);
        const n2Ptr = this._getNodePtr(node2Id);

        const dim1 = this.Module.get_node_dim(n1Ptr);
        const dim2 = this.Module.get_node_dim(n2Ptr);

        if (values.length !== dim1 * dim2) {
            throw new Error(`Values length ${values.length} != ${dim1}*${dim2}.`);
        }

        const factorPtr = this.Module.new_factor2d(dim1, dim2);

        for (let i = 0; i < values.length; i++) {
            const row = Math.floor(i / dim2);
            const col = i % dim2;
            this.Module.set_factor2d_at(factorPtr, row, col, values[i]);
        }

        this.Module.connect_nodes(n1Ptr, n2Ptr, factorPtr);

        const factorId = `edge_${node1Id}_${node2Id}_${this.nextFactorId++}`;
        this.factors.set(factorId, { ptr: factorPtr, type: 'factor2d' });
    }

    setEvidence(nodeId, value) {
        this.Module.set_evidence(this._getNodePtr(nodeId), value);
    }

    runBeliefPropagation(nodeIds, iterations) {
        if (nodeIds.length === 0) return;
        this.Module.run_belief_propagation(nodeIds, iterations);
    }

    getMarginal(nodeId) {
        const nodePtr = this._getNodePtr(nodeId);
        const dim = this.Module.get_node_dim(nodePtr);
        const outPtr = this.Module.new_factor1d(dim);

        this.Module.compute_univariate_marginal(nodePtr, outPtr);

        const result = [];
        for (let i = 0; i < dim; i++) {
            result.push(this.Module.get_factor1d_at(outPtr, i));
        }

        this.Module.delete_factor1d(outPtr);
        return result;
    }

    resetMessages() {
        for (const ptr of this.nodes.values()) {
            this.Module.reset_messages(ptr);
        }
    }

    destroy() {
        if (this.isDestroyed) return;
        this.isDestroyed = true;

        for (const id of this.nodes.keys()) {
            this.Module._unregister_node(id);
        }

        for (const { ptr, type } of this.factors.values()) {
            if (type === 'factor1d') {
                this.Module.delete_factor1d(ptr);
            } else {
                this.Module.delete_factor2d(ptr);
            }
        }

        for (const ptr of this.nodes.values()) {
            this.Module.delete_node(ptr);
        }

        this.nodes.clear();
        this.factors.clear();
    }

    _getNodePtr(nodeId) {
        const ptr = this.nodes.get(nodeId);
        if (ptr === undefined) throw new Error(`Node ${nodeId} not found.`);
        return ptr;
    }
}

export async function createMRFGraph(wasmPath) {
    const { default: createMRFModule } = await import('./mrf.js');
    const module = await createMRFModule();
    return new MRFGraph(module);
}