/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    workerThreads: false,  // 禁用 worker 线程池解决 Windows EPERM 问题
  },
}

module.exports = nextConfig