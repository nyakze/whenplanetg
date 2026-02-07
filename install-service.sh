#!/bin/bash

# WhenPlane Telegram Bot Service Setup Script
# Run this as root (with sudo) to install the systemd service

if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root: sudo bash install-service.sh"
    exit 1
fi

BOT_DIR="/home/ubuntu/whenplane/telegram-bot"
SERVICE_NAME="whenplane-bot"

# Copy service file
cp "$BOT_DIR/whenplane-bot.service" /etc/systemd/system/

# Reload systemd
systemctl daemon-reload

# Enable service (starts on boot)
systemctl enable $SERVICE_NAME

# Start service now
systemctl start $SERVICE_NAME

echo "✅ Service installed and started!"
echo ""
echo "Commands to manage:"
echo "  sudo systemctl status $SERVICE_NAME  - Check status"
echo "  sudo systemctl stop $SERVICE_NAME    - Stop bot"
echo "  sudo systemctl start $SERVICE_NAME   - Start bot"
echo "  sudo systemctl restart $SERVICE_NAME - Restart bot"
echo "  sudo journalctl -u $SERVICE_NAME -f  - View logs"
echo ""
echo "Bot is running! Check Telegram to test it."
