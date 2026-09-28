# Face analysis release security gate

This service must not be deployed from a build that fails
`npm run test:face-analysis-release`.

The release gate fails closed unless the production dependency audit has no
critical findings and the Node 20 container passes the real 68-landmark,
no-face, multiple-face, HTTP contract, and non-root runtime checks.

The compatibility-pinned TensorFlow.js dependency tree had 2 moderate, 5 high,
and 1 critical audit findings on 2026-09-10. Those findings are not accepted as
production-safe by this repository. A compatible upgrade or an explicit,
time-bounded security exception is required before deployment.
