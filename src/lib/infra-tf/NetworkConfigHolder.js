const { IPv4 } = require( "ip-num/IPNumber" )

function defineType( net_set ) {
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
  return net_type
}

function computePrimaryCidr( cidr, idx ) {
  return cidr.replace( /<vpc_idx>/, "" + idx)
}

function computeCidr( first_net_set_ip, net_size, az_idx) {
  
  const displacement = net_size * az_idx;
  let first_net_ip = new IPv4( first_net_set_ip ).value + BigInt( displacement );
  const net_first_ip =  IPv4.fromNumber( first_net_ip ).toString()
  const net_size_bit = 32 - Math.log2( net_size )
  return net_first_ip + "/" + net_size_bit
}

class NetworkConfigHolder {

  constructor( vpc_cfg /*: VpcConfig[] */, vpc_idx /*: number */, azs /*: number */, env_code /*: string */ ) {
    
    const nets = [];
    for( let net_set of vpc_cfg.networks ) {
      for( let az_idx = 0; az_idx < azs; az_idx++ ) {
  
        let net_type = defineType( net_set );

        const first_ip = computePrimaryCidr( net_set.first_net_ip, vpc_idx )
        const net_cidr = computeCidr( first_ip, net_set.net_size, az_idx )
  
        nets.push({
          code: `${vpc_cfg.code}_${net_set.code}_${az_idx}`,
          net_set_code: `${net_set.code}`,
          vpc_code: `${vpc_cfg.code}`,
          name: `${vpc_cfg.name} - ${net_set.name} Subnet (${env_code}) AZ ${az_idx}`,
          cidr: net_cidr,
          type: net_type,
          az: `az_${az_idx}`,
        })
      }
    }

    this._nets = nets;
    this._vpc_cfg = vpc_cfg;
  }

  getCidrsByType( net_type ) {
    return this._nets
      .filter( n => n.type == net_type)
      .map( n => n.cidr)
  }

  getNamesByType( net_type ) {
    return this._nets
      .filter( n => n.type == net_type)
      .map( n => n.name)
  }

  getCidrsByNetSet( net_set_code ) {
    return this._nets
      .filter( n => n.net_set_code == net_set_code)
      .map( n => n.cidr)
  }

  getAwsSvcSubnetsCidrs() {
    return this._nets
      .filter( n => n.net_set_code == this._vpc_cfg?.aws_svc?.net)
      .map( n => n.cidr)
  }

  getAwsSvcInterfaceEndpoints() {
    return this._vpc_cfg?.aws_svc?.interfaces_endpoints || []
  }
  
}


module.exports = {
  NetworkConfigHolder
}
