import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
const { defineProps, withDefaults, } = {};
const props = withDefaults(defineProps(), {
    description: "",
    lazy: false,
});
const frameRef = ref(null);
const videoRef = ref(null);
const reducedMotion = ref(typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
const nearViewport = ref(!props.lazy);
const shouldRenderVideo = computed(() => !reducedMotion.value && nearViewport.value);
let mediaQuery = null;
let observer = null;
function playVideo() {
    if (!shouldRenderVideo.value || !videoRef.value)
        return;
    void videoRef.value.play().catch(() => {
        // Autoplay can still be blocked by a browser policy. The poster remains visible.
    });
}
function syncReducedMotion(event) {
    reducedMotion.value = event?.matches ?? mediaQuery?.matches ?? false;
}
watch(shouldRenderVideo, async (visible) => {
    await nextTick();
    if (visible)
        playVideo();
    else
        videoRef.value?.pause();
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
        if (entry.isIntersecting)
            playVideo();
        else
            videoRef.value?.pause();
    }, { rootMargin: "320px 0px" });
    if (frameRef.value)
        observer.observe(frameRef.value);
    playVideo();
});
onBeforeUnmount(() => {
    mediaQuery?.removeEventListener?.("change", syncReducedMotion);
    observer?.disconnect();
    videoRef.value?.pause();
});
const __VLS_defaults = {
    description: "",
    lazy: false,
};
void __VLS_defaults;
const __VLS_ctx = {
    ...{},
    ...{},
    ...{},
};
let __VLS_components;
let __VLS_intrinsics;
let __VLS_directives;
void __VLS_ctx, __VLS_components, __VLS_intrinsics, __VLS_directives;
const __VLS_template = () => {
    __VLS_withDotValue(shouldRenderVideo, {});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ref: "frameRef",
        ...{ class: "landing-video-frame" },
    });
    /** @type {__VLS_StyleScopedClasses['landing-video-frame']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.img)({
        ...{ class: "landing-video-poster" },
        src: (__VLS_ctx.poster),
        alt: "",
        'aria-hidden': "true",
        loading: (__VLS_ctx.lazy ? 'lazy' : 'eager'),
        fetchpriority: (__VLS_ctx.lazy ? 'low' : 'high'),
    });
    /** @type {__VLS_StyleScopedClasses['landing-video-poster']} */ ;
    if (shouldRenderVideo.value) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.video, __VLS_intrinsics.video)({
            ...{ onLoadeddata: (playVideo) },
            ref: "videoRef",
            ...{ class: "landing-video" },
            src: (__VLS_ctx.src),
            poster: (__VLS_ctx.poster),
            autoplay: true,
            muted: true,
            loop: true,
            playsinline: true,
            preload: (__VLS_ctx.lazy ? 'none' : 'metadata'),
            'aria-label': (__VLS_ctx.ariaLabel),
        });
        /** @type {__VLS_StyleScopedClasses['landing-video']} */ ;
    }
    else {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "landing-video-static" },
            role: "img",
            'aria-label': (__VLS_ctx.ariaLabel),
        });
        /** @type {__VLS_StyleScopedClasses['landing-video-static']} */ ;
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "sr-only" },
    });
    /** @type {__VLS_StyleScopedClasses['sr-only']} */ ;
    (__VLS_ctx.description || __VLS_ctx.ariaLabel);
    // @ts-ignore
    [poster, poster, lazy, lazy, lazy, shouldRenderVideo, src, ariaLabel, ariaLabel, ariaLabel, description,];
    return {};
};
void [__VLS_template];
const __VLS_export = (await import('vue')).defineComponent({
    __typeProps: {},
    props: {},
});
export default {};
