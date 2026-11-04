// Demo mode: simulated M-Pesa payments, simulated SMS, and callback URLs that
// work without secrets. Always on in development (`next dev`). In a
// production build it is OFF unless DEMO_MODE=true is set on purpose, so a
// real deployment that is missing its keys fails closed instead of letting
// anyone mark orders paid or use the USSD menu as someone else's phone.
export const isProductionBuild = process.env.NODE_ENV === 'production';
export const demoMode = !isProductionBuild || process.env.DEMO_MODE === 'true';
/** True when a production build is deliberately running as a public demo (shows a banner). */
export const publicDemo = isProductionBuild && process.env.DEMO_MODE === 'true';
