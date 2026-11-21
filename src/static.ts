/** Static builds are read-only and load pre-exported JSON instead of calling the server. */
export const IS_STATIC = import.meta.env.VITE_STATIC === "1";
