type InfraConfig = {
  envs: {
    [key: string]: EnvConfig
  },
  accounts: AccountConfig[]
}

type EnvConfig = {
  vpcs: EnvVpcConfig[],
  azs: number,
  accounts: EnvAccountConfig[]
}

type EnvVpcConfig = {
  code: string,
  idx: number
}

type EnvAccountConfig = {
  code: string,
  base_dns: string
}

type AccountConfig = {
  code: string,
  vpcs: VpcConfig[]
  dns?: {
    api?: string[],
    cdn?: string[]
  }
  has_apigw: boolean
}

type VpcConfig = {
  code: string,
  name: string,
  primary_cidr: string,
  networks: SubnetsSetConfig[],
  aws_svc: {
    net: string,
    interfaces_endpoints: string[]
  }
}

type SubnetsSetConfig = {
  code: string,
  name: string,
  net_size: number,
  first_net_ip: string,
  has_nat?: boolean,
  gateway?: {
    type: "igw"|"nat",
    nat_network?: string
  },
  interface_endpoints?: string[]
}

