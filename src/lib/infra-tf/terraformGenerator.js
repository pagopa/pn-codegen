const path = require("node:path")
const { writeFile } = require("node:fs/promises");
const { loadConfiguration } = require( "./ConfigHolder" )

async function terraformGenerator( tfGeneratorConfig, prj_path ) {
  
  console.log("Codegen input for TF", tfGeneratorConfig );

  const project_root_relative_path = (
      tfGeneratorConfig['cfg-file-project-path'] || 'codegen/pn-infra-configurations.yaml'
    );
  const config_file_absolute_path = path.resolve( 'microsvc/' + project_root_relative_path );
  
  const configs = await loadConfiguration( config_file_absolute_path );
  
  const account_code = tfGeneratorConfig.account_code;
  console.info( `##### Generate networking configurations for account ${account_code}` );

  for( let env_code of configs.env_code_list ) {
    
    console.info( `=== Select environment ${env_code}` );

    generateEnv( configs, account_code, env_code, prj_path )
    
  }
}


function toTfSymbol( s ) {
  return s.replace(/-/g, '_');
}

async function generateEnv( configs /*: ConfigHolder */, account_code /*: string*/, env_code /*: string */, prj_path /*: string */  ) {
  
  const output_path = `${prj_path}/src/main/env/${env_code}/terraform.tfvars`
  
  
  const azs  = configs.getNumberOfAz( env_code );
  
  const account_base_dns = configs.getBaseDns( account_code, env_code );
  const api_domain_arr = configs.getApiEndpointsList( account_code );
  const cdn_domain_arr = configs.getCdnEndpointsList( account_code );
  const api_gw_custom_domains_arr = configs.getApiGwCustomDomains( account_code );
  
  const api_domain_list = JSON.stringify( api_domain_arr );
  const cdn_domain_list = JSON.stringify( cdn_domain_arr );
  const api_gw_custom_domains_list = JSON.stringify( api_gw_custom_domains_arr );

  let terraform_file_content = `
    environment = "${env_code}"
    how_many_az = ${azs}
    dns_zone = "${account_base_dns}"
    api_domains = ${api_domain_list}
    cdn_domains = ${cdn_domain_list}
    apigw_custom_domains = ${api_gw_custom_domains_list}
  `

  for( let env_account_code of configs.listEnvAccounts( env_code ) ) {
    const aws_id = configs.getAwsAccountId( env_account_code, env_code )
    terraform_file_content += `
      ${toTfSymbol(env_account_code)}_aws_account_id = "${aws_id}"`
    
    const vpcse_map = configs.getVpcSe( env_account_code, env_code )
    for( let vpcse_key in vpcse_map ) {
      terraform_file_content += `
        ${toTfSymbol(env_account_code)}_${toTfSymbol(vpcse_key)}_vpcse = "${vpcse_map[vpcse_key]}"`
    }

    const params_map = configs.getGenericParams( env_account_code, env_code )
    for( let key in params_map ) {
      terraform_file_content += `
        ${toTfSymbol(key)} = "${params_map[key]}"`
    }
  }


  for ( let vpc_code of configs.listVpcsCodes( account_code ) ) {
    const vpc_name = configs.getVpcName( account_code, vpc_code )
    const primary_cidr = configs.computePrimaryCidr( env_code, account_code, vpc_code );

    const networks = configs.buildNetworkList( env_code, account_code, vpc_code );

    const private_net_cidr = JSON.stringify( networks.getCidrsByType( "private" ) )
    const private_net_name = JSON.stringify( networks.getNamesByType( "private" ) )
    const public_net_cidr = JSON.stringify( networks.getCidrsByType( "public" ) )
    const public_net_name = JSON.stringify( networks.getNamesByType( "public" ) )
    const intra_net_cidr = JSON.stringify( networks.getCidrsByType( "intra" ) )
    const intra_net_name = JSON.stringify( networks.getNamesByType( "intra" ) )

    const aws_service_net_cidr = JSON.stringify( networks.getAwsSvcSubnetsCidrs() )
    const iface_endpoint_list = JSON.stringify( networks.getAwsSvcInterfaceEndpoints() )

    terraform_file_content += `


      vpc_${toTfSymbol(vpc_code)}_name = "${vpc_name}"
      vpc_${toTfSymbol(vpc_code)}_primary_cidr = "${primary_cidr}"
      vpc_${toTfSymbol(vpc_code)}_aws_services_interface_endpoints_subnets_cidr = ${aws_service_net_cidr}
      vpc_endpoints_${toTfSymbol(vpc_code)} = ${iface_endpoint_list}

      vpc_${toTfSymbol(vpc_code)}_private_subnets_cidr = ${private_net_cidr}
      vpc_${toTfSymbol(vpc_code)}_private_subnets_names = ${private_net_name}
      vpc_${toTfSymbol(vpc_code)}_public_subnets_cidr = ${public_net_cidr}
      vpc_${toTfSymbol(vpc_code)}_public_subnets_names = ${public_net_name}
      vpc_${toTfSymbol(vpc_code)}_internal_subnets_cidr = ${intra_net_cidr}
      vpc_${toTfSymbol(vpc_code)}_internal_subnets_names = ${intra_net_name}
    
    `;
    
    const exported_networks_sets = configs.listSubnetsSetsToBeExported( account_code, vpc_code )
    for( const net_set_code of exported_networks_sets ) {
      const cidr_list = JSON.stringify( networks.getCidrsByNetSet(net_set_code))
      terraform_file_content += 
        `vpc_${toTfSymbol(vpc_code)}_${toTfSymbol(net_set_code)}_subnets_cidrs = ${cidr_list}\n`;
    }
    terraform_file_content += "\n\n"
  }

  terraform_file_content = terraform_file_content
    .replace(/^        /gm, '')
    .replace(/^      /gm, '')
    .replace(/^    /gm, '');
  
  console.log( "Write " + output_path )
  await writeFile( output_path, terraform_file_content, { encoding: "utf-8"});
}

module.exports = {
  terraformGenerator
}

