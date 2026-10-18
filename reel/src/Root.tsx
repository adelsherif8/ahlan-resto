import { Composition } from 'remotion';
import { Final } from './Final';
import { Tex, Typing, Screen, CityTex } from './Assets';
import { FPS, T, setVariant, Variant } from './lib/timeline';
import { Post, postTiming } from './Post';
import { Chat, chatTiming } from './Chat';
import { Scene } from './Scene';
import { OG } from './OG';
import { STORIES, storyLength } from './lib/stories';
import { THREADS } from './lib/threads';
import { POSTS } from './lib/posts';
import { KineticReel } from './Kinetic';
import { KINETIC, kineticTiming } from './lib/kinetic';
import { Loop, LoopStill } from './Loop';
import { Film } from './Film';
import { FilmShort, shortEnd } from './FilmShort';
import { Carousel } from './Carousel';
import { StoryQ } from './StoryQ';
import { filmTiming } from './lib/film';
import { loopTiming } from './lib/loop';

const calc = ({ props }: { props: { variant?: Variant } }) => {
  setVariant(props.variant ?? 'holo');
  return { durationInFrames: T.dur };
};

export const Root = () => (
  <>
    <Composition id="Final" component={Final} durationInFrames={812} fps={FPS} width={1080} height={1920}
      defaultProps={{ variant: 'holo' as Variant }} calculateMetadata={calc} />
    <Composition
      id="Post"
      component={Post}
      fps={FPS}
      width={1080}
      height={1920}
      durationInFrames={300}
      defaultProps={{ post: '1A' }}
      calculateMetadata={({ props }) => {
        const p = POSTS[(props as { post?: string }).post ?? '1A'] ?? POSTS['1A']!;
        return { durationInFrames: Math.round(postTiming(p).end) };
      }}
    />
    <Composition
      id="Kinetic"
      component={KineticReel}
      fps={FPS}
      width={1080}
      height={1920}
      durationInFrames={400}
      defaultProps={{ reel: 'R3' }}
      calculateMetadata={({ props }) => {
        const r = KINETIC[(props as { reel?: string }).reel ?? 'R3'] ?? KINETIC['R3']!;
        return { durationInFrames: kineticTiming(r).end };
      }}
    />
    <Composition
      id="Chat"
      component={Chat}
      fps={FPS}
      width={1080}
      height={1920}
      durationInFrames={600}
      defaultProps={{ thread: 'T1' }}
      calculateMetadata={({ props }) => {
        const t = THREADS[(props as { thread?: string }).thread ?? 'T1'] ?? THREADS['T1']!;
        return { durationInFrames: Math.round(chatTiming(t).end) };
      }}
    />
    <Composition
      id="Scene"
      component={Scene}
      fps={FPS}
      width={1080}
      height={1920}
      durationInFrames={980}
      defaultProps={{ story: 'night' }}
      calculateMetadata={({ props }) => {
        const st = STORIES[(props as { story?: string }).story ?? 'night'] ?? STORIES['night']!;
        return { durationInFrames: storyLength(st) };
      }}
    />
    <Composition id="FilmShort" component={FilmShort} durationInFrames={shortEnd()} fps={FPS} width={1080} height={1920} />
    <Composition id="Carousel" component={Carousel} durationInFrames={1} fps={FPS} width={1080} height={1350} defaultProps={{ deck: 'A', slide: 0 }} />
    <Composition id="StoryQ" component={StoryQ} durationInFrames={210} fps={FPS} width={1080} height={1920} defaultProps={{ index: 0 }} />
    <Composition id="Film" component={Film} durationInFrames={filmTiming().end} fps={FPS} width={1080} height={1920} />
    <Composition id="Loop" component={Loop} durationInFrames={loopTiming().end} fps={FPS} width={1080} height={1920} defaultProps={{ video: false }} />
    <Composition id="LoopStill" component={LoopStill} durationInFrames={1} fps={FPS} width={1080} height={1350} />
    <Composition id="OG" component={OG} durationInFrames={1} fps={FPS} width={1200} height={630} />
    <Composition id="Tex" component={Tex} durationInFrames={21} fps={FPS} width={1700} height={1500} />
    <Composition id="CityTex" component={CityTex} durationInFrames={5} fps={FPS} width={3072} height={3072} />
    <Composition id="Typing" component={Typing} durationInFrames={960} fps={FPS} width={270} height={180} />
    <Composition id="Screen" component={Screen} durationInFrames={960} fps={FPS} width={600} height={1290} />
  </>
);
