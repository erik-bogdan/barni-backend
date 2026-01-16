import { auth } from "./auth";

export { auth } from "../../lib/auth"


let _schema: ReturnType<typeof auth.api.generateOpenAPISchema>;
const getSchema = async () => {
	if (!_schema) {
		_schema = auth.api.generateOpenAPISchema();
	}
	return _schema;
};

export const OpenAPI = {
	getPaths: (prefix = "/api/auth") =>
		getSchema().then(({ paths }) => {
			const reference: typeof paths = Object.create(null);

			for (const path of Object.keys(paths)) {
				const key = prefix + path;
				reference[key] = paths[path];

				for (const method of Object.keys(paths[path])) {
					// biome-ignore lint/suspicious/noExplicitAny: TypeScript does not infer the type correctly here
					const operation = (reference[key] as any)[method];

					operation.tags = ["Better Auth"];
				}
			}

			return reference;
			// biome-ignore lint/suspicious/noExplicitAny: TypeScript does not infer the type correctly here
		}) as Promise<any>,
	// biome-ignore lint/suspicious/noExplicitAny: TypeScript does not infer the type correctly here
	components: getSchema().then(({ components }) => components) as Promise<any>,
} as const;
