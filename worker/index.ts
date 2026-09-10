import { handleApi } from './api.ts'
import type { SquareEnv } from './square/client.ts'

export default {
  fetch(request, env): Promise<Response> {
    return handleApi(request, env, import.meta.env.DEV)
  },
} satisfies ExportedHandler<Env & SquareEnv>
