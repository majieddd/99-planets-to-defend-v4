/** Plain JSON. Everything in simulation state is one of these, so saves and hashes are exact. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };
