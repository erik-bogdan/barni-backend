import { z } from 'zod'

export const CreatePocketBodySchema = z.object({
  name: z.string().min(1).max(100),
  currency: z.string().min(1).max(16),
})

export type CreatePocketBody = z.infer<typeof CreatePocketBodySchema>

export const UpdatePocketBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  currency: z.string().min(1).max(16).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
})

export type UpdatePocketBody = z.infer<typeof UpdatePocketBodySchema>

export const PocketIdParamsSchema = z.object({
  id: z.string().regex(/^\d+$/),
})

export type PocketIdParams = z.infer<typeof PocketIdParamsSchema>


