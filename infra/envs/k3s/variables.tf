variable "admin_cidr" {
  description = "Your public IP as x.x.x.x/32"
  type        = string

  validation {
    condition     = endswith(var.admin_cidr, "/32")
    error_message = "admin_cidr must be a single address ending in /32."
  }
}

variable "key_name" {
  description = "Existing EC2 key pair name"
  type        = string
  default     = "gada-key"
}

variable "instance_type" {
  type    = string
  default = "t3.medium"
}
