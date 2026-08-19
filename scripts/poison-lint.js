// poison: empty catch violates no-empty with allowEmptyCatch:false
try { JSON.parse('{}'); } catch (e) {}
