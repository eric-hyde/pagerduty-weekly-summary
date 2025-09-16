#!/bin/bash

# PagerDuty Weekly Report Setup Script
# This script checks dependencies and sets up the environment

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Node.js version
check_node() {
    print_status "Checking Node.js installation..."
    
    if ! command_exists node; then
        print_error "Node.js is not installed. Please install Node.js 18+ from https://nodejs.org/"
        exit 1
    fi
    
    NODE_VERSION=$(node --version | cut -d'v' -f2)
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'.' -f1)
    
    if [ "$MAJOR_VERSION" -lt 18 ]; then
        print_error "Node.js version $NODE_VERSION is too old. Please upgrade to Node.js 18 or higher."
        exit 1
    fi
    
    print_success "Node.js version $NODE_VERSION is compatible"
}

# Install npm dependencies
install_dependencies() {
    print_status "Installing npm dependencies..."
    
    if [ -f "package-lock.json" ]; then
        npm ci
    else
        npm install
    fi
    
    print_success "Dependencies installed successfully"
}

# Check and setup Ollama
setup_ollama() {
    print_status "Checking Ollama installation..."
    
    if ! command_exists ollama; then
        print_warning "Ollama is not installed."
        echo
        read -p "Would you like to install Ollama now? (y/N): " -n 1 -r
        echo
        
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_status "Installing Ollama..."
            
            # Detect OS and install accordingly
            if [[ "$OSTYPE" == "darwin"* ]]; then
                # macOS
                if command_exists brew; then
                    brew install ollama
                else
                    curl -fsSL https://ollama.ai/install.sh | sh
                fi
            elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
                # Linux
                curl -fsSL https://ollama.ai/install.sh | sh
            else
                print_error "Unsupported OS. Please install Ollama manually from https://ollama.ai/"
                exit 1
            fi
            
            print_success "Ollama installed successfully"
        else
            print_warning "Skipping Ollama installation. You'll need to install it manually later."
            return 0
        fi
    else
        print_success "Ollama is already installed"
    fi
    
    # Check if Ollama server is running
    print_status "Checking if Ollama server is running..."
    
    if curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
        print_success "Ollama server is running"
    else
        print_warning "Ollama server is not running."
        echo
        read -p "Would you like to start Ollama server now? (y/N): " -n 1 -r
        echo
        
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_status "Starting Ollama server..."
            
            # Start Ollama in background
            if [[ "$OSTYPE" == "darwin"* ]]; then
                # macOS - use launchctl if available, otherwise background process
                if command_exists launchctl; then
                    ollama serve > /dev/null 2>&1 &
                    OLLAMA_PID=$!
                    print_status "Ollama server started with PID $OLLAMA_PID"
                else
                    nohup ollama serve > /dev/null 2>&1 &
                    print_status "Ollama server started in background"
                fi
            else
                # Linux
                nohup ollama serve > /dev/null 2>&1 &
                print_status "Ollama server started in background"
            fi
            
            # Wait a moment for server to start
            sleep 3
            
            # Check again
            if curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
                print_success "Ollama server is now running"
            else
                print_error "Failed to start Ollama server. Please start it manually with: ollama serve"
            fi
        else
            print_warning "Skipping Ollama server startup. Remember to run 'ollama serve' before using the report tool."
        fi
    fi
    
    # Check for required model
    setup_ollama_model
}

# Setup Ollama model
setup_ollama_model() {
    print_status "Checking for Ollama models..."
    
    # Get model from .env file if it exists
    MODEL="llama3.2:3b"  # Default model
    if [ -f ".env" ]; then
        ENV_MODEL=$(grep "OLLAMA_MODEL=" .env 2>/dev/null | cut -d'=' -f2 | tr -d '"' | tr -d "'")
        if [ ! -z "$ENV_MODEL" ]; then
            MODEL="$ENV_MODEL"
        fi
    fi
    
    # Check if model exists
    if curl -s http://localhost:11434/api/tags 2>/dev/null | grep -q "\"name\":\"$MODEL\""; then
        print_success "Model '$MODEL' is already available"
    else
        print_warning "Model '$MODEL' is not available."
        echo
        read -p "Would you like to download the model now? This may take several minutes. (y/N): " -n 1 -r
        echo
        
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_status "Downloading model '$MODEL'... This may take a while."
            
            if ollama pull "$MODEL"; then
                print_success "Model '$MODEL' downloaded successfully"
            else
                print_error "Failed to download model '$MODEL'. You can download it later with: ollama pull $MODEL"
            fi
        else
            print_warning "Skipping model download. Remember to run 'ollama pull $MODEL' before using the report tool."
        fi
    fi
}

# Setup environment file
setup_environment() {
    print_status "Setting up environment configuration..."
    
    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example .env
            print_success "Created .env file from .env.example"
            print_warning "Please edit .env file with your actual credentials before running the report tool."
            
            echo
            echo "Required configuration:"
            echo "  - PD_API_TOKEN: Your PagerDuty API token"
            echo "  - PD_TEAM_IDS: Your PagerDuty team IDs (comma-separated)"
            echo "  - PD_SCHEDULES: Your PagerDuty schedule IDs (comma-separated)"
            echo "  - SLACK_WORKFLOW_WEBHOOK_URL: Your Slack workflow webhook URL"
            echo
        else
            print_error ".env.example file not found. Please create one manually."
        fi
    else
        print_success ".env file already exists"
    fi
}

# Test the setup
test_setup() {
    print_status "Testing setup..."
    
    # Check if .env has required variables
    if [ -f ".env" ]; then
        MISSING_VARS=""
        
        if ! grep -q "^PD_API_TOKEN=" .env || grep -q "PD_API_TOKEN=your_" .env; then
            MISSING_VARS="$MISSING_VARS PD_API_TOKEN"
        fi
        
        if ! grep -q "^PD_TEAM_IDS=" .env || grep -q "PD_TEAM_IDS=TEAM_" .env; then
            MISSING_VARS="$MISSING_VARS PD_TEAM_IDS"
        fi
        
        if ! grep -q "^SLACK_WORKFLOW_WEBHOOK_URL=" .env || grep -q "SLACK_WORKFLOW_WEBHOOK_URL=https://hooks.slack.com/triggers/" .env; then
            MISSING_VARS="$MISSING_VARS SLACK_WORKFLOW_WEBHOOK_URL"
        fi
        
        if [ ! -z "$MISSING_VARS" ]; then
            print_warning "The following environment variables need to be configured in .env:"
            for var in $MISSING_VARS; do
                echo "  - $var"
            done
            echo
        fi
    fi
    
    # Test basic functionality
    if node -e "console.log('Node.js test passed')" >/dev/null 2>&1; then
        print_success "Node.js functionality test passed"
    else
        print_error "Node.js functionality test failed"
    fi
}

# Main setup function
main() {
    echo
    echo "========================================"
    echo "  PagerDuty Weekly Report Setup"
    echo "========================================"
    echo
    
    check_node
    install_dependencies
    setup_ollama
    setup_environment
    test_setup
    
    echo
    echo "========================================"
    echo "  Setup Complete!"
    echo "========================================"
    echo
    print_success "Setup completed successfully!"
    echo
    echo "Next steps:"
    echo "1. Edit .env file with your actual credentials"
    echo "2. Test the setup: npm run dev"
    echo "3. Run a report: npm start"
    echo "4. Schedule automatic reports by setting ENABLE_CRON=true in .env"
    echo
    echo "For help, run: node index.js --help"
    echo
}

# Run main function
main "$@"
