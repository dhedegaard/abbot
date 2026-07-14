import * as z from 'zod'

const ENV = z.object({
  USER: z.string().min(1),
  PASSWORD: z.string().min(1),
  HEADLESS: z.enum(['1', '0']).transform((value) => value === '1'),
  OUTPUT_DIR: z
    .optional(z.string())
    .transform((value) => (value == null || value === '' ? undefined : value)),
  SENTRY_DSN: z
    .optional(z.string())
    .transform((value) => (value == null || value === '' ? undefined : value)),
})
interface ENV extends z.infer<typeof ENV> {}
export const env: ENV = ENV.parse(process.env, { reportInput: true })
