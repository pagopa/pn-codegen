const { load } = require( "js-yaml" )
const { readFile, writeFile } = require( "node:fs/promises" )

const { NetworkConfigHolder } = require( "./NetworkConfigHolder" )

class ConfigHolder {

  constructor( loaded_configurations /* InfraConfig */) {
    this.configurations = loaded_configurations; // InfraConfig

    this._env_code_list = Object.keys( this.configurations.envs );
    this._env_code_list.sort();
  }

  get raw_data() {
    return this.configurations;
  }

  get env_code_list() {
    return this._env_code_list;
  }

  _getAccount( account_code ) {
    const found = this.configurations.accounts.filter( (a ) => a.code == account_code )
    return found.length == 0 ? null : found[0]
  }

  _getAccountVpc( account_code, vpc_code ) {
    const account = this._getAccount( account_code );
    const vpc_arr = account?.vpcs || []
    const found = vpc_arr.filter( v => v.code == vpc_code )

    return found.length == 0 ? null : found[0]
  }

  getApiEndpointsList( account_code ) {
    const account = this._getAccount( account_code );
    return account?.dns?.api || [];
  }

  getApiGwCustomDomains( account_code ) {
    const account = this._getAccount( account_code );
    
    let result;
    if( account?.has_apigw ) {
      result =  this.getApiEndpointsList( account_code )
    }
    else {
      result = []
    }
    return result;
  }

  getCdnEndpointsList( account_code ) {
    const account = this._getAccount( account_code );
    return account?.dns?.cdn || [];
  }
  
  getBaseDns( account_code, env_code ) {
    let arr = this.configurations.envs[ env_code ]?.accounts;
    
    if( arr ) {
      arr = arr.filter( (a) => a.code == account_code );
    }
    else {
      arr = []
    }

    return arr.length == 0 ? null : arr[0].base_dns;
  }

  getAwsAccountId( account_code, env_code ) {
    let arr = this.configurations.envs[ env_code ]?.accounts;
    
    if( arr ) {
      arr = arr.filter( (a) => a.code == account_code );
    }
    else {
      arr = []
    }

    return arr.length == 0 ? null : arr[0].aws_id;
  }

  getVpcSe( account_code, env_code ) {
    let arr = this.configurations.envs[ env_code ]?.accounts;
    
    if( arr ) {
      arr = arr.filter( (a) => a.code == account_code );
    }
    else {
      arr = []
    }

    return arr.length == 0 ? {} : arr[0].vpcse;
  }

  listEnvAccounts( env_code ) {
    let arr = this.configurations.envs[ env_code ]?.accounts || [];

    return arr.map( a => a.code)
  }

  getNumberOfAz( env_code ) {
    return this.configurations.envs[ env_code ]?.azs
  }

  _getEnvVpc( env_code, vpc_code ) {
    const env_vpc_arr = this.configurations.envs[ env_code ]?.vpcs
                                    ?.filter( vpc => vpc.code == vpc_code );
    const env_vpc =  env_vpc_arr.length == 0 ? null : env_vpc_arr[0];
    return env_vpc;
  }

  computePrimaryCidr( env_code, account_code, vpc_code ) {
    
    const env_vpc = this._getEnvVpc( env_code, vpc_code )

    // Select the generic vpc configuration
    const vpc = this._getAccountVpc( account_code, vpc_code );
    const primary_cidr_template =  vpc?.primary_cidr

    let primary_cidr = "";
    if( primary_cidr_template ) {
      primary_cidr = primary_cidr_template.replace( /<vpc_idx>/, "" + env_vpc.idx)
    }
    
    return primary_cidr;
  }

  buildNetworkList( env_code, account_code, vpc_code ) {
    const azs = this.getNumberOfAz( env_code );
    const vpc_cfg = this._getAccountVpc( account_code, vpc_code );
    const vpc_idx = this._getEnvVpc( env_code, vpc_code )?.idx
    
    return new NetworkConfigHolder( vpc_cfg, vpc_idx, azs, env_code );
  }

  listSubnetsSetsToBeExported( account_code, vpc_code ) {
    const vpc_cfg = this._getAccountVpc( account_code, vpc_code );
    
    const arr = vpc_cfg?.networks || [];

    return arr.filter( n => n.export_cidrs || n.nlb ).map( n => n.code )
  }

  listVpcsCodes( account_code ) {
    const account = this._getAccount( account_code );
    const vpc_arr = account?.vpcs || []
    
    return vpc_arr.map( v => v.code)
  }

  getVpcName( account_code, vpc_code ) {
    return this._getAccountVpc( account_code, vpc_code )?.name || ""
  }
}

async function loadConfiguration( abs_config_file_path /*: string */ ) /*: InfraConfig */{
  
  const config_file_yaml = await readFile( abs_config_file_path, { encoding: "utf-8" });
  
  const config_obj = load( config_file_yaml );
  return new ConfigHolder( config_obj );
}

module.exports = {
  loadConfiguration
}

