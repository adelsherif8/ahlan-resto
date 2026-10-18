// Screen anchors for the Higgsfield plate (public/loop/loop-start-2k.png + clipA/clipB), 1080x1920.
// Beats: clip A 0-142 (6s @ 24fps -> 30fps), hold, clip B, end card.
export const LOOP_GEO = {
  order: { x: 560, y: 1540 },   // the last car in the queue sends the order
  top: { x: 300, y: 560 },       // the restaurant front: the ticket reply
  back: { x: 464, y: 1745 },     // the Munadim car is back beside the customer
  beats: { up0: 20, up1: 198, down0: 236, down1: 414, frames: 480 },
};
