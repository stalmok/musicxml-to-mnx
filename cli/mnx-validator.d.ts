// The module scripts/mnx-validator.ts generates from the vendored schema.

export interface SchemaError {
  instancePath: string
  message?: string
}

export declare const validate: {
  (document: unknown): boolean
  errors?: SchemaError[] | null
}
