'use strict';

// CRC view — client-side descriptor.
// The actual rendering is handled by app.js (the single CRC view component
// in v2). This module exists to satisfy the view registry contract and
// make the view selector aware of the CRC view.

const CRCView = {
  id:            'crc',
  label:         'CRC',
  defaultParams: {},
  sweepRate:     5000,
};

// Register in global view registry
window.VIEW_REGISTRY = window.VIEW_REGISTRY || {};
window.VIEW_REGISTRY['crc'] = CRCView;
