<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  src: string;
  poster: string;
  ariaLabel: string;
  description?: string;
  lazy?: boolean;
}>(), {
  description: "",
  lazy: false,
});

const frameRef = ref<HTMLElement | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);
const reducedMotion = ref(typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
const nearViewport = ref(!props.lazy);
const shouldRenderVideo = computed(() => !reducedMotion.value && nearViewport.value);

let mediaQuery: MediaQueryList | null = null;
let observer: IntersectionObserver | null = null;

function playVideo() {
  if (!shouldRenderVideo.value || !videoRef.value) return;
  void videoRef.value.play().catch(() => {
    // Autoplay can still be blocked by a browser policy. The poster remains visible.
  });
}

function syncReducedMotion(event?: MediaQueryListEvent) {
  reducedMotion.value = event?.matches ?? mediaQuery?.matches ?? false;
}

watch(shouldRenderVideo, async (visible) => {
  await nextTick();
  if (visible) playVideo();
  else videoRef.value?.pause();
});

onMounted(() => {
  mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  syncReducedMotion();
  mediaQuery.addEventListener?.("change", syncReducedMotion);

  if (typeof IntersectionObserver === "undefined") {
    nearViewport.value = true;
    playVideo();
    return;
  }

  observer = new IntersectionObserver(([entry]) => {
    nearViewport.value = entry.isIntersecting;
    if (entry.isIntersecting) playVideo();
    else videoRef.value?.pause();
  }, { rootMargin: "320px 0px" });

  if (frameRef.value) observer.observe(frameRef.value);
  playVideo();
});

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener?.("change", syncReducedMotion);
  observer?.disconnect();
  videoRef.value?.pause();
});
</script>

<template>
  <div ref="frameRef" class="landing-video-frame">
    <img class="landing-video-poster" :src="poster" alt="" aria-hidden="true" :loading="lazy ? 'lazy' : 'eager'" :fetchpriority="lazy ? 'low' : 'high'" />
    <video
      v-if="shouldRenderVideo"
      ref="videoRef"
      class="landing-video"
      :src="src"
      :poster="poster"
      autoplay
      muted
      loop
      playsinline
      :preload="lazy ? 'none' : 'metadata'"
      :aria-label="ariaLabel"
      @loadeddata="playVideo"
    ></video>
    <div v-else class="landing-video-static" role="img" :aria-label="ariaLabel"></div>
    <span class="sr-only">{{ description || ariaLabel }}</span>
  </div>
</template>
