import { createFrontendConfig } from '../vite.config.js'
import { cashierApi } from './cashierApi.js'
import { pwa } from './pwa.js'

export default createFrontendConfig('cashier', 5173, [cashierApi(), pwa()])
