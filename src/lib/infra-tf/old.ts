
import { load } from "js-yaml";
import { readFile, writeFile } from "node:fs/promises"
import { config } from "node:process"
import { IPv4 } from "ip-num/IPNumber";



function selectAccount( cfg: InfraConfig, account_code: string ): AccountConfig {
  for( let a of cfg.accounts ) {
    if( a.code == account_code ) {
      return a;
    }
  }
  throw new Error("Account " + account_code + " not configured");
}

function selectEnv( cfg: InfraConfig, env_code: string ): EnvConfig {
  let ec = cfg.envs[ env_code ];
  if( !ec ) {
    throw new Error("Account " + env_code + " not configured");
  }
  return ec;
}

function selectEnvVpc( env_cfg: EnvConfig, vpc_code: string ): EnvVpcConfig {
  for( let ev of env_cfg.vpcs ) {
    if( ev.code == vpc_code ) {
      return ev;
    }
  }
  throw new Error("VPC " + vpc_code + " not configured in environment cfg");
}

function selectEnvAccount( env_cfg: EnvConfig, account_code: string ): EnvAccountConfig {
  for( let ea of env_cfg.accounts ) {
    if( ea.code == account_code ) {
      return ea;
    }
  }
  throw new Error("VPC " + account_code + " not configured in environment cfg");
}

async function main( config_file_path: string ): Promise<void> {
  
  console.info("Load Configuration file", config_file_path );
  const config_file_yaml = await readFile( config_file_path, { encoding: "utf-8" })
  const configs: InfraConfig = load( config_file_yaml ) as InfraConfig;

  for( let env_code in configs.envs ) {

    const env_cfg = selectEnv( configs, env_code );

    for( let a of configs.accounts ) {
      const account_code = a.code

      const account_cfg = selectAccount( configs, account_code );
    
      
      generateVpc( account_cfg, env_cfg, account_code, env_code )
    }
  }
  
}


const config_file_path = process.argv[2]
main( config_file_path )

function computePrimaryCidr( cidr: string, idx: number) {
  return cidr.replace( /<vpc_idx>/, "" + idx)
}

function toTfSymbol( s: string): string {
  return s.replace(/-/g, '_');
}


function computeCidr( first_net_set_ip: string, net_size: number, az_idx: number): string {
  const displacement = ((( net_size * az_idx ) as unknown) as bigint)
  let first_net_ip = new IPv4( first_net_set_ip ).value + BigInt( displacement );
  const net_first_ip =  IPv4.fromNumber( first_net_ip ).toString()
  const net_size_bit = 32 - Math.log2( net_size )
  return net_first_ip + "/" + net_size_bit
}

function computeNetworksInformation( vpc_cfg: VpcConfig, azs: number, envVpcCfg: EnvVpcConfig, env_code: string ): SubnetCfg[] {
  const vpc_code = vpc_cfg.code

  const nets: SubnetCfg[] = []

  for( let net_set of vpc_cfg.networks ) {
    for( let az_idx = 0; az_idx < azs; az_idx++ ) {

      let net_type;
      if( net_set.gateway ) {
        if( net_set.gateway.type == "igw" ) {
          net_type = "public"
        }
        else {
          net_type = "private"
        }
      }
      else {
        net_type = "intra";
      }
      
      const first_ip = computePrimaryCidr( net_set.first_net_ip, envVpcCfg.idx )
      const net_cidr = computeCidr( first_ip, net_set.net_size, az_idx )

      nets.push({
        code: `${vpc_code}_${net_set.code}_${az_idx}`,
        net_set_code: `${net_set.code}`,
        vpc_code: `${vpc_code}`,
        name: `${vpc_cfg.name} - ${net_set.name} Subnet (${env_code}) AZ ${az_idx}`,
        cidr: net_cidr,
        type: net_type,
        az: `az_${az_idx}`,
      })
    }
  }

  return nets;
}

function toFieldArrayByType(networks: SubnetCfg[], net_type: string, field: string) {
  
  const result: string[] = networks.filter( n => n.type == net_type)
    .map( n => {
      switch( field ) {
        case "cidr": return n.cidr;
        case "name": return n.name;
        case "code": return n.code;
        default: throw new Error("field not supported: " + field)
      }
    })
  return JSON.stringify( result );
}

function toFieldArrayByCode(networks: SubnetCfg[], net_code: string, field: string) {
  
  const result: string[] = networks.filter( n => n.net_set_code == net_code)
    .map( n => {
      switch( field ) {
        case "cidr": return n.cidr;
        case "name": return n.name;
        case "code": return n.code;
        default: throw new Error("field not supported: " + field)
      }
    })
  return JSON.stringify( result );
}


async function generateVpc(account_cfg: AccountConfig, env_cfg: EnvConfig, account_code: string, env_code: string ) {
  
  const output_path = `../runtime-infra/src/${account_code}/env/${env_code}/terraform.tfvars`
  const azs = env_cfg.azs;

  const env_account_cfg = selectEnvAccount( env_cfg, account_code )
  const api_domain_list = JSON.stringify( account_cfg?.dns?.api || [] )
  const cdn_domain_list = JSON.stringify( account_cfg?.dns?.cdn || [] )
  const has_apigw = account_cfg.has_apigw

  let terraform_file_content = `
    env_code = "${env_code}"
    how_many_az = ${azs}
    base_domain_name = "${env_account_cfg.base_dns}"
    api_domains = ${api_domain_list}
    cdn_domains = ${cdn_domain_list}
    apigw_custom_domains = ${has_apigw ? api_domain_list : "[]"}
  `

  for ( let vpc_cfg of account_cfg.vpcs ) {
  
    const vpc_code = vpc_cfg.code
    const env_vpc_cfg = selectEnvVpc( env_cfg, vpc_code )
    
    const primary_cidr = computePrimaryCidr( vpc_cfg.primary_cidr, env_vpc_cfg.idx )

    const networks = computeNetworksInformation( vpc_cfg, azs, env_vpc_cfg, env_code)

    const private_net_cidr = toFieldArrayByType( networks, "private", "cidr")
    const private_net_name = toFieldArrayByType( networks, "private", "name")
    const public_net_cidr = toFieldArrayByType( networks, "public", "cidr")
    const public_net_name = toFieldArrayByType( networks, "public", "name")
    const intra_net_cidr = toFieldArrayByType( networks, "intra", "cidr")
    const intra_net_name = toFieldArrayByType( networks, "intra", "name")

    const aws_service_net_cidr = toFieldArrayByCode( networks, vpc_cfg.aws_svc.net, "cidr")
    const iface_endpoint_list = JSON.stringify( vpc_cfg.aws_svc.interfaces_endpoints )

    terraform_file_content += `

      vpc_${toTfSymbol(vpc_code)}_name = "${vpc_cfg.name}"
      vpc_${toTfSymbol(vpc_code)}_primary_cidr = "${primary_cidr}"
      vpc_${toTfSymbol(vpc_code)}_aws_services_interface_endpoints_subnets_cidr = ${aws_service_net_cidr}

      vpc_${toTfSymbol(vpc_code)}_private_subnets_cidr = ${private_net_cidr}
      vpc_${toTfSymbol(vpc_code)}_private_subnets_names = ${private_net_name}
      vpc_${toTfSymbol(vpc_code)}_public_subnets_cidr = ${public_net_cidr}
      vpc_${toTfSymbol(vpc_code)}_public_subnets_names = ${public_net_name}
      vpc_${toTfSymbol(vpc_code)}_internal_subnets_cidr = ${intra_net_cidr}
      vpc_${toTfSymbol(vpc_code)}_internal_subnets_names = ${intra_net_name}

      vpc_endpoints_${toTfSymbol(vpc_code)} = ${iface_endpoint_list}
    `;
    
    console.log(account_code, env_code, output_path)
  }

  terraform_file_content = terraform_file_content
    .replace(/^      /gm, '')
    .replace(/^    /gm, '');
  await writeFile( output_path, terraform_file_content, { encoding: "utf-8"});
}

// EIP, NLB per Cross Account Networking
