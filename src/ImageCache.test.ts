import { describe, it, expect, beforeEach } from 'vitest';
import ImageCache from './ImageCache.js';

describe('ImageCache', () => {
  let cache: ImageCache;

  beforeEach(() => {
    cache = new ImageCache({ maxCacheSize: 3 });
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const defaultCache = new ImageCache({});
      expect(defaultCache['maxCacheSize']).toBe(100);
    });

    it('should initialize with custom max size', () => {
      const customCache = new ImageCache({ maxCacheSize: 50 });
      expect(customCache['maxCacheSize']).toBe(50);
    });
  });

  describe('set and get', () => {
    it('should store and retrieve image', () => {
      const imageUrl = 'https://example.com/image.jpg';
      const processedImage = 'data:image/jpeg;base64,abc123';

      cache.set(imageUrl, 'anthropic', processedImage);
      const retrieved = cache.get(imageUrl, 'anthropic');

      expect(retrieved).toBe(processedImage);
    });

    it('should return null for non-existent image', () => {
      const result = cache.get('https://example.com/missing.jpg', 'anthropic');
      expect(result).toBeNull();
    });

    it('should return null for wrong provider', () => {
      cache.set('https://example.com/image.jpg', 'anthropic', 'data');
      const result = cache.get('https://example.com/image.jpg', 'openai');

      expect(result).toBeNull();
    });

    it('should store multiple formats for same image', () => {
      const imageUrl = 'https://example.com/image.jpg';

      cache.set(imageUrl, 'anthropic', 'anthropic-data');
      cache.set(imageUrl, 'openai', 'openai-data');

      expect(cache.get(imageUrl, 'anthropic')).toBe('anthropic-data');
      expect(cache.get(imageUrl, 'openai')).toBe('openai-data');
    });
  });

  describe('has', () => {
    it('should return true for cached image', () => {
      const imageUrl = 'https://example.com/image.jpg';
      cache.set(imageUrl, 'anthropic', 'data');

      expect(cache.has(imageUrl, 'anthropic')).toBe(true);
    });

    it('should return false for non-cached image', () => {
      expect(cache.has('https://example.com/missing.jpg', 'anthropic')).toBe(false);
    });

    it('should return false for wrong provider', () => {
      cache.set('https://example.com/image.jpg', 'anthropic', 'data');
      expect(cache.has('https://example.com/image.jpg', 'openai')).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return all formats for an image', () => {
      const imageUrl = 'https://example.com/image.jpg';

      cache.set(imageUrl, 'anthropic', 'anthropic-data');
      cache.set(imageUrl, 'openai', 'openai-data');

      const all = cache.getAll(imageUrl);
      expect(all).toEqual({
        anthropic: 'anthropic-data',
        openai: 'openai-data'
      });
    });

    it('should return null for non-existent image', () => {
      const result = cache.getAll('https://example.com/missing.jpg');
      expect(result).toBeNull();
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entry when cache is full', () => {
      cache.set('image1', 'anthropic', 'data1');
      cache.set('image2', 'anthropic', 'data2');
      cache.set('image3', 'anthropic', 'data3');

      // Cache is now full (max 3)
      expect(cache['cache'].size).toBe(3);

      // Add one more - should evict image1
      cache.set('image4', 'anthropic', 'data4');

      expect(cache['cache'].size).toBe(3);
      expect(cache.has('image1', 'anthropic')).toBe(false);
      expect(cache.has('image4', 'anthropic')).toBe(true);
    });

    it('should update LRU order on access', () => {
      cache.set('image1', 'anthropic', 'data1');
      cache.set('image2', 'anthropic', 'data2');
      cache.set('image3', 'anthropic', 'data3');

      // Access image1 - moves it to end
      cache.get('image1', 'anthropic');

      // Add one more - should evict image2 (oldest)
      cache.set('image4', 'anthropic', 'data4');

      expect(cache.has('image1', 'anthropic')).toBe(true);
      expect(cache.has('image2', 'anthropic')).toBe(false);
      expect(cache.has('image4', 'anthropic')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('image1', 'anthropic', 'data1');
      cache.set('image2', 'openai', 'data2');

      cache.clear();

      expect(cache['cache'].size).toBe(0);
      expect(cache.has('image1', 'anthropic')).toBe(false);
      expect(cache.has('image2', 'openai')).toBe(false);
    });
  });

  describe('statistics', () => {
    it('should track hits and misses', () => {
      cache.set('image1', 'anthropic', 'data1');

      cache.get('image1', 'anthropic'); // Hit
      cache.get('image2', 'anthropic'); // Miss
      cache.get('image1', 'anthropic'); // Hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe('66.67%');
    });

    it('should track stores', () => {
      cache.set('image1', 'anthropic', 'data1');
      cache.set('image2', 'anthropic', 'data2');

      const stats = cache.getStats();
      expect(stats.stores).toBe(2);
    });

    it('should track evictions', () => {
      cache.set('image1', 'anthropic', 'data1');
      cache.set('image2', 'anthropic', 'data2');
      cache.set('image3', 'anthropic', 'data3');
      cache.set('image4', 'anthropic', 'data4'); // Should evict

      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });

    it('should reset statistics', () => {
      cache.get('image1', 'anthropic'); // Miss
      cache.set('image1', 'anthropic', 'data1');

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.stores).toBe(0);
    });
  });

  describe('memory size estimation', () => {
    it('should estimate memory usage for string images', () => {
      cache.set('image1', 'anthropic', 'data:image/jpeg;base64,abc123');

      const size = cache.getMemorySize();
      expect(size.bytes).toBeGreaterThan(0);
      expect(parseFloat(size.kb)).toBeGreaterThan(0);
    });

    it('should handle empty cache', () => {
      const size = cache.getMemorySize();
      expect(size.bytes).toBe(0);
      expect(size.kb).toBe('0.00');
      expect(size.mb).toBe('0.00');
    });
  });

  describe('provider statistics', () => {
    it('should count entries per provider', () => {
      cache.set('image1', 'anthropic', 'data1');
      cache.set('image2', 'anthropic', 'data2');
      cache.set('image3', 'openai', 'data3');

      const providerStats = cache.getProviderStats();
      expect(providerStats.anthropic).toBe(2);
      expect(providerStats.openai).toBe(1);
      expect(providerStats.bedrock).toBe(0);
      expect(providerStats.deepseek).toBe(0);
    });
  });

  describe('key generation', () => {
    it('should generate same key for same URL', () => {
      const url = 'https://example.com/image.jpg';

      cache.set(url, 'anthropic', 'data1');
      cache.set(url, 'openai', 'data2');

      // Should be stored under same key
      expect(cache.getAll(url)).toEqual({
        anthropic: 'data1',
        openai: 'data2'
      });
    });

    it('should handle data URLs', () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';

      cache.set(dataUrl, 'anthropic', 'processed');
      expect(cache.get(dataUrl, 'anthropic')).toBe('processed');
    });

    it('should handle image_url object format', () => {
      const imageObj = {
        image_url: 'https://example.com/image.jpg'
      };

      cache.set(imageObj, 'anthropic', 'data');
      expect(cache.get(imageObj, 'anthropic')).toBe('data');

      // Should match string URL
      expect(cache.get('https://example.com/image.jpg', 'anthropic')).toBe('data');
    });

    it('should handle nested image_url object', () => {
      const imageObj = {
        image_url: {
          url: 'https://example.com/image.jpg'
        }
      };

      cache.set(imageObj, 'anthropic', 'data');
      expect(cache.get(imageObj, 'anthropic')).toBe('data');
    });
  });
});
