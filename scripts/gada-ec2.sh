#!/bin/bash

set -e

# ==========================================
# CONFIGURATION
# ==========================================

REGION="ap-south-1"

KEY_NAME="gada-key"
KEY_PATH="$HOME/.ssh/$KEY_NAME.pem"

SG_NAME="gada-sg"

INSTANCE_TYPE="t3.micro"
INSTANCE_NAME="gada-server"

STATE_DIR="$(dirname "$0")/../.aws-state"

INSTANCE_FILE="$STATE_DIR/instance-id"
SG_FILE="$STATE_DIR/security-group-id"

AMI_OWNER="099720109477"

export AWS_DEFAULT_REGION="$REGION"

mkdir -p "$HOME/.ssh"
mkdir -p "$STATE_DIR"


# ==========================================
# HELPER: CHECK AWS CLI
# ==========================================

check_aws() {

    if ! command -v aws >/dev/null 2>&1; then
        echo "ERROR: AWS CLI is not installed."
        exit 1
    fi

    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        echo "ERROR: AWS credentials are invalid."
        exit 1
    fi

}


# ==========================================
# HELPER: GET PUBLIC IP
# ==========================================

get_public_ip() {

    MYIP=$(curl -fsS https://checkip.amazonaws.com | tr -d '\r\n')

    if [ -z "$MYIP" ]; then
        echo "ERROR: Unable to retrieve public IP."
        exit 1
    fi

    echo "$MYIP"

}


# ==========================================
# HELPER: CONFIGURE SECURITY GROUP
# ==========================================

configure_security_group() {

    SG="$1"
    MYIP="$2"

    for PORT in 22 3000; do

        echo "Checking inbound port $PORT..."

        RULE_EXISTS=$(aws ec2 describe-security-group-rules \
            --filters "Name=group-id,Values=$SG" \
            --query "SecurityGroupRules[?IsEgress==\`false\` && IpProtocol=='tcp' && FromPort==\`$PORT\` && ToPort==\`$PORT\` && CidrIpv4=='$MYIP/32'].SecurityGroupRuleId | [0]" \
            --output text)

        if [ "$RULE_EXISTS" = "None" ]; then

            echo "Adding port $PORT for $MYIP..."

            aws ec2 authorize-security-group-ingress \
                --group-id "$SG" \
                --protocol tcp \
                --port "$PORT" \
                --cidr "$MYIP/32"

        else

            echo "Port $PORT already configured."

        fi

    done

}


# ==========================================
# HELPER: GET UBUNTU AMI
# ==========================================

get_ubuntu_ami() {

    echo "Retrieving latest Ubuntu 24.04 AMI..."

    AMI=$(aws ec2 describe-images \
        --owners "$AMI_OWNER" \
        --filters \
            "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" \
            "Name=state,Values=available" \
        --query 'Images | sort_by(@, &CreationDate)[-1].ImageId' \
        --output text \
        --region "$REGION")

    if [ -z "$AMI" ] || [ "$AMI" = "None" ]; then
        echo "ERROR: Unable to retrieve Ubuntu AMI."
        exit 1
    fi

    echo "Ubuntu AMI: $AMI"

}


# ==========================================
# HELPER: GET OR CREATE KEY PAIR
# ==========================================

create_key_pair() {

    if ! aws ec2 describe-key-pairs \
        --key-names "$KEY_NAME" >/dev/null 2>&1; then

        echo "Creating SSH key pair..."

        aws ec2 create-key-pair \
            --key-name "$KEY_NAME" \
            --query KeyMaterial \
            --output text > "$KEY_PATH"

        chmod 400 "$KEY_PATH"

    elif [ ! -f "$KEY_PATH" ]; then

        echo "ERROR: AWS key exists but local PEM is missing."
        exit 1

    fi

    echo "SSH key: $KEY_PATH"

}


# ==========================================
# HELPER: GET OR CREATE SECURITY GROUP
# ==========================================

create_security_group() {

    SG=$(aws ec2 describe-security-groups \
        --filters "Name=group-name,Values=$SG_NAME" \
        --query 'SecurityGroups[0].GroupId' \
        --output text)

    if [ "$SG" = "None" ]; then

        echo "Creating Security Group..."

        SG=$(aws ec2 create-security-group \
            --group-name "$SG_NAME" \
            --description "Gada lab security group" \
            --query GroupId \
            --output text)

    else

        echo "Using existing Security Group: $SG"

    fi

    echo "$SG" > "$SG_FILE"

}


# ==========================================
# PROVISION EC2 INSTANCE
# ==========================================

provision() {

    check_aws

    echo "======================================"
    echo "STARTING EC2 PROVISIONING"
    echo "======================================"

    # 1. Get current public IP

    MYIP=$(get_public_ip)

    echo "Your Public IP: $MYIP"


    # 2. Create SSH key

    create_key_pair


    # 3. Create Security Group

    create_security_group


    # 4. Configure inbound rules

    configure_security_group "$SG" "$MYIP"


    # 5. Retrieve Ubuntu AMI

    get_ubuntu_ami


    # 6. Check existing EC2 instance

    EXISTING_ID=$(aws ec2 describe-instances \
        --filters \
            "Name=tag:Name,Values=$INSTANCE_NAME" \
            "Name=instance-state-name,Values=pending,running,stopping,stopped" \
        --query 'Reservations[].Instances[].InstanceId | [0]' \
        --output text)

    if [ "$EXISTING_ID" != "None" ]; then

        ID="$EXISTING_ID"

        echo "Existing instance found: $ID"

        STATE=$(aws ec2 describe-instances \
            --instance-ids "$ID" \
            --query 'Reservations[0].Instances[0].State.Name' \
            --output text)

        case "$STATE" in

            stopped)

                echo "Starting stopped instance..."

                aws ec2 start-instances \
                    --instance-ids "$ID" >/dev/null

                ;;

            stopping)

                echo "Waiting for instance to stop..."

                aws ec2 wait instance-stopped \
                    --instance-ids "$ID"

                aws ec2 start-instances \
                    --instance-ids "$ID" >/dev/null

                ;;

            running)

                echo "Instance is already running."

                ;;

            pending)

                echo "Instance is already starting."

                ;;

        esac

    else

        # 7. Launch new EC2 instance

        echo "Launching new EC2 instance..."

        ID=$(aws ec2 run-instances \
            --image-id "$AMI" \
            --instance-type "$INSTANCE_TYPE" \
            --key-name "$KEY_NAME" \
            --security-group-ids "$SG" \
            --tag-specifications \
            "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" \
            --query 'Instances[0].InstanceId' \
            --output text)

    fi

    echo "$ID" > "$INSTANCE_FILE"


    # 8. Wait for running state

    aws ec2 wait instance-running \
        --instance-ids "$ID"


    # 9. Retrieve public IP

    IP=$(aws ec2 describe-instances \
        --instance-ids "$ID" \
        --query 'Reservations[0].Instances[0].PublicIpAddress' \
        --output text)

    echo ""
    echo "======================================"
    echo "EC2 INSTANCE READY"
    echo "======================================"

    echo "Instance ID : $ID"
    echo "Public IP   : $IP"
    echo "Region      : $REGION"

    echo ""
    echo "SSH COMMAND:"

    echo "ssh -i \"$KEY_PATH\" ubuntu@$IP"

}


# ==========================================
# STOP EC2 INSTANCE
# ==========================================

stop_instance() {

    check_aws

    if [ ! -f "$INSTANCE_FILE" ]; then
        echo "ERROR: Instance ID not found."
        exit 1
    fi

    ID=$(cat "$INSTANCE_FILE")

    echo "Stopping instance: $ID"

    STATE=$(aws ec2 describe-instances \
        --instance-ids "$ID" \
        --query 'Reservations[0].Instances[0].State.Name' \
        --output text)

    if [ "$STATE" = "stopped" ]; then

        echo "Instance is already stopped."
        exit 0

    fi

    if [ "$STATE" = "terminated" ]; then

        echo "Instance is already terminated."
        exit 1

    fi

    aws ec2 stop-instances \
        --instance-ids "$ID" >/dev/null

    aws ec2 wait instance-stopped \
        --instance-ids "$ID"

    echo ""
    echo "======================================"
    echo "INSTANCE STOPPED SUCCESSFULLY"
    echo "======================================"

    echo "Instance ID: $ID"

}


# ==========================================
# DESTROY EC2 INFRASTRUCTURE
# ==========================================

destroy() {

    check_aws

    echo ""
    echo "======================================"
    echo "WARNING: DESTROY AWS INFRASTRUCTURE"
    echo "======================================"

    echo "This operation will:"
    echo "1. Terminate the EC2 instance."
    echo "2. Delete EBS volumes attached to it."
    echo "3. Delete the Gada Security Group."
    echo ""
    echo "Your SSH key pair and local PEM file will be retained."
    echo ""

    read -r -p "Are you sure? Type YES to continue: " CONFIRM

    if [ "$CONFIRM" != "YES" ]; then
        echo "Destroy operation cancelled."
        return
    fi


    # 1. Retrieve instance ID

    if [ -f "$INSTANCE_FILE" ]; then

        ID=$(cat "$INSTANCE_FILE")

    else

        ID=$(aws ec2 describe-instances \
            --filters \
                "Name=tag:Name,Values=$INSTANCE_NAME" \
                "Name=instance-state-name,Values=pending,running,stopping,stopped" \
            --query 'Reservations[].Instances[].InstanceId | [0]' \
            --output text)

    fi


    # 2. Capture attached EBS volumes before termination

    if [ "$ID" != "None" ] && [ -n "$ID" ]; then

        echo "Instance found: $ID"

        STATE=$(aws ec2 describe-instances \
            --instance-ids "$ID" \
            --query 'Reservations[0].Instances[0].State.Name' \
            --output text)

        if [ "$STATE" != "terminated" ]; then

            VOLUMES=$(aws ec2 describe-instances \
                --instance-ids "$ID" \
                --query 'Reservations[0].Instances[0].BlockDeviceMappings[].Ebs.VolumeId' \
                --output text)

            # 3. Terminate instance

            echo "Terminating EC2 instance..."

            aws ec2 terminate-instances \
                --instance-ids "$ID" >/dev/null

            aws ec2 wait instance-terminated \
                --instance-ids "$ID"

            echo "EC2 instance terminated."

            # 4. Delete remaining attached EBS volumes

            if [ "$VOLUMES" != "None" ] && [ -n "$VOLUMES" ]; then

                for VOL in $VOLUMES; do

                    echo "Checking EBS volume: $VOL"

                    VOL_STATE=$(aws ec2 describe-volumes \
                        --volume-ids "$VOL" \
                        --query 'Volumes[0].State' \
                        --output text 2>/dev/null || true)

                    if [ "$VOL_STATE" = "available" ]; then

                        echo "Deleting EBS volume: $VOL"

                        aws ec2 delete-volume \
                            --volume-id "$VOL"

                    elif [ "$VOL_STATE" = "None" ] || [ -z "$VOL_STATE" ]; then

                        echo "Volume $VOL was already deleted."

                    else

                        echo "WARNING: Volume $VOL is in state $VOL_STATE."
                        echo "Could not delete this volume automatically."

                    fi

                done

            else

                echo "No remaining EBS volumes found."

            fi

        else

            echo "Instance is already terminated."

        fi

    else

        echo "No EC2 instance found."

    fi


    # 5. Delete Security Group

    if [ -f "$SG_FILE" ]; then

        SG=$(cat "$SG_FILE")

    else

        SG=$(aws ec2 describe-security-groups \
            --filters "Name=group-name,Values=$SG_NAME" \
            --query 'SecurityGroups[0].GroupId' \
            --output text)

    fi

    if [ "$SG" != "None" ] && [ -n "$SG" ]; then

        echo "Deleting Security Group: $SG"

        if aws ec2 delete-security-group \
            --group-id "$SG"; then

            echo "Security Group deleted."

        else

            echo "WARNING: Security Group could not be deleted."
            echo "It may still be associated with another resource."

        fi

    else

        echo "Security Group does not exist."

    fi


    # 6. Clean local state files

    rm -f "$INSTANCE_FILE"
    rm -f "$SG_FILE"

    echo ""
    echo "======================================"
    echo "DESTROY OPERATION COMPLETED"
    echo "======================================"

    echo "EC2 instance: Terminated (if found)"
    echo "EBS volumes: Checked for deletion"
    echo "Security Group: Deletion attempted"
    echo "SSH key pair: Retained"
    echo "Local PEM: Retained"

}


# ==========================================
# MAIN
# ==========================================

case "$1" in

    provision)

        provision

        ;;

    stop)

        stop_instance

        ;;

    destroy)

        destroy

        ;;

    *)

        echo ""
        echo "Usage: $0 {provision|stop|destroy}"
        echo ""
        echo "Available commands:"
        echo ""
        echo "  provision  Create or start EC2 instance"
        echo "  stop       Stop EC2 instance"
        echo "  destroy    Terminate EC2 and clean resources"
        echo ""

        exit 1

        ;;

esac