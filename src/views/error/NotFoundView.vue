<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
    <main class="container">
        <h1>404</h1>
        <p>
            没有这个地址：<code>{{ route.fullPath }}</code>
        </p>
        <RouterLink to="/">返回首页</RouterLink>
    </main>
</template>

<style scoped>
.container {
    padding-top: 10vh;
    text-align: center;
}

code {
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    background-color: rgba(127, 127, 127, 0.18);
}
</style>
