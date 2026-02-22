#pragma once
#include <deque>
#include <vector>
#include <stdexcept>
#include <algorithm>

// ═══════════════════════════════════════════════════════════
//  FIFO Queue Data Structure — Core DSA Component
//  Template-based, thread-safe ready, with display slicing
// ═══════════════════════════════════════════════════════════

template<typename T>
class Queue {
private:
    std::deque<T> data_;
    size_t maxDisplaySize_;

public:
    explicit Queue(size_t maxDisplay = 10) : maxDisplaySize_(maxDisplay) {}

    // ── Core Queue Operations ─────────────────────────────
    void enqueue(const T& item) {
        data_.push_back(item);
    }

    T dequeue() {
        if (data_.empty()) throw std::runtime_error("Queue underflow");
        T front = data_.front();
        data_.pop_front();
        return front;
    }

    const T& peek() const {
        if (data_.empty()) throw std::runtime_error("Queue is empty");
        return data_.front();
    }

    const T& back() const {
        if (data_.empty()) throw std::runtime_error("Queue is empty");
        return data_.back();
    }

    // ── Accessors ─────────────────────────────────────────
    size_t size() const { return data_.size(); }
    bool empty() const { return data_.empty(); }
    size_t displaySize() const { return maxDisplaySize_; }

    // Get ALL items (full history)
    std::vector<T> getAll() const {
        return std::vector<T>(data_.begin(), data_.end());
    }

    // Get last N items (for queue visualization panel)
    std::vector<T> getLast(size_t n) const {
        if (n >= data_.size()) return getAll();
        return std::vector<T>(data_.end() - n, data_.end());
    }

    // Get the display queue (last maxDisplaySize_ items)
    std::vector<T> getDisplayQueue() const {
        return getLast(maxDisplaySize_);
    }

    void clear() { data_.clear(); }

    // ── Iterator support ──────────────────────────────────
    auto begin() { return data_.begin(); }
    auto end() { return data_.end(); }
    auto begin() const { return data_.begin(); }
    auto end() const { return data_.end(); }
};
