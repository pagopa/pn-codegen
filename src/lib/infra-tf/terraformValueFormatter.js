/**
 * Formats values for Terraform output
 * @param {any} value Input value to format
 * @returns {string|null} Terraform-compatible string or null
 * @example
 * formatParamValue({port: 8080})         → {"port":8080}
 * formatParamValue(["example","test"])    → ["example","test"] 
 * formatParamValue({x:1, y:"test"})      → {"x":1,"y":"test"}
 */
function formatParamValue(value) {
    
    if (value === null || value === undefined) {
        return null;
    }

    if (Array.isArray(value) || typeof value === "object") {
        return JSON.stringify(value);
    }

    switch (typeof value) {
        case "string":
            return `"${value}"`;
        case "number":
        case "boolean":
            return String(value);
        default:
            return `"${value}"`;
    }
}

module.exports = {
    formatParamValue
}