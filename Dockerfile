FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
RUN apt-get update && apt-get install -y \
    g++ \
    libssl-dev \
    libmongoc-dev \
    libbson-dev \
    pkg-config \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download header-only libraries
RUN mkdir -p include && \
    wget -q -O include/httplib.h "https://raw.githubusercontent.com/yhirose/cpp-httplib/v0.18.3/httplib.h" && \
    wget -q -O include/json.hpp "https://raw.githubusercontent.com/nlohmann/json/v3.11.3/single_include/nlohmann/json.hpp"

# Copy source code
COPY cpp/ cpp/
COPY public/ public/

# Build C++ server (full mode: MongoDB + OpenSSL)
RUN g++ -std=c++17 -O2 \
    -DCPPHTTPLIB_OPENSSL_SUPPORT \
    -DUSE_MONGODB \
    -o server cpp/server.cpp \
    -Iinclude -Icpp \
    $(pkg-config --cflags libmongoc-1.0) \
    -lssl -lcrypto -lpthread \
    $(pkg-config --libs libmongoc-1.0)


ENV PORT=10000
EXPOSE 10000

# Use shell form so stdout is not buffered
CMD ["./server"]
