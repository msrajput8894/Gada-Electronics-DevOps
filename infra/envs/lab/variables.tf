variable "name" {
  description = "Prefix for resource names"
  type        = string
  default     = "gada"
}

variable "vpc_cidr" {
  description = "Address range of the VPC"
  type        = string
  default     = "10.20.0.0/16"
}

variable "admin_cidr" {
  description = "Your public IP in CIDR form, for example 203.0.113.7/32. Only this address can reach the servers."
  type        = string

  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && var.admin_cidr != "0.0.0.0/0"
    error_message = "admin_cidr must be a valid CIDR range and must not be 0.0.0.0/0."
  }
}

variable "key_name" {
  description = "Name of an existing EC2 key pair used for SSH"
  type        = string
  default     = "gada-key"
}

variable "app_instance_type" {
  description = "Instance size for the app server"
  type        = string
  default     = "t3.micro"
}

variable "data_instance_type" {
  description = "Instance size for the data server"
  type        = string
  default     = "t3.micro"
}
