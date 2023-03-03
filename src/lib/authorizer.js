function getSecuritySchemeByIntendedUsage(intendedUsage, authorizerConfig){
    return authorizerConfig.securitySchemes[intendedUsage]
}

function getMethodSecurityItemsByIntendedUsage(intendedUsage, authorizerConfig){
    return authorizerConfig.methodSecurity[intendedUsage]
}

module.exports = {
    getSecuritySchemeByIntendedUsage,
    getMethodSecurityItemsByIntendedUsage
}