import { scenes, srcSet, type SceneId } from "@/lib/scenes";

type Props = {
  id: SceneId;
  /** A portrait scene for phones (below 768 px), served through the same <picture>. */
  phone?: SceneId;
  /** The `sizes` hint for the browser; most scenes are full width. */
  sizes?: string;
  /** The hero: loaded first and at high priority. Everything else is lazy. */
  priority?: boolean;
  /** CSS object-position; the seats assume the same value (see Seat). */
  position?: string;
  className?: string;
};

/**
 * A painted scene that covers its box (spec section 8): AVIF with a WebP fallback at several widths, the dominant
 * colour and a blurred preview underneath so nothing flashes while it loads. Scenes are decorative, so alt is empty.
 */
export function Scene({ id, phone, sizes = "100vw", priority = false, position = "50% 100%", className = "" }: Props) {
  const scene = scenes[id];
  const small = phone ? scenes[phone] : null;
  const largest = scene.sources.at(-1);
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 overflow-hidden bg-cover ${className}`}
      style={{ backgroundColor: scene.color, backgroundImage: `url("${scene.preview}")`, backgroundPosition: position }}
    >
      <picture>
        {small && <source media="(max-width: 767px)" type="image/avif" srcSet={srcSet(small, "avif")} sizes="100vw" />}
        {small && <source media="(max-width: 767px)" type="image/webp" srcSet={srcSet(small, "webp")} sizes="100vw" />}
        <source type="image/avif" srcSet={srcSet(scene, "avif")} sizes={sizes} />
        <img
          src={largest?.webp}
          srcSet={srcSet(scene, "webp")}
          sizes={sizes}
          alt=""
          width={largest?.width}
          height={largest?.height}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          // Never sync: a sync decode of the hero's AVIF held the whole first paint (headline included) until it decoded,
          // 2.4 s on a throttled phone. The colour and blurred preview underneath cover the wait.
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          style={{ objectPosition: position }}
        />
      </picture>
    </div>
  );
}
