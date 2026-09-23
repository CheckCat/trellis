// What every practice strategy needs and none of them should re-invent:
// the strategy contract itself, the "find this lesson's assignment" lookup,
// and the two refusals that are the same whatever kind of assignment it is.
//
// Deliberately NOT here: anything about SQL, sandboxes, typed-in answers or
// their schemas. A strategy owns its own request/response shape end to end
// — that is what lets a future `code` or `file` mechanic be a new module
// rather than a new branch in a shared handler.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { practiceTypeCapability, type CoursePracticeType } from "../../capabilities/index.js";
import type { Course, CoursePractice } from "../../courses/types.js";
import { findLesson, type LessonLocation } from "../../progress/model/index.js";
import { sendCourseNotFound, sendLessonNotFound } from "../../routes/progress/index.js";

/**
 * One practice mechanic's HTTP surface.
 *
 * A strategy registers its own route(s) on the shared Fastify instance and
 * is otherwise free: its own body schema, its own response, its own
 * dependencies (the `sql` one needs a sandbox, the `answer` one needs
 * nothing). `routes/practice/index.ts` only loops over the registry — it
 * never names a type, which is why adding one does not change it.
 */
export interface PracticeStrategy {
  /** The `practice.type` this grades. Must be registered in
   * capabilities.ts — that is where a type comes into existence. */
  readonly type: CoursePracticeType;
  /** Registers this strategy's routes. Called once, at plugin load. */
  register(fastify: FastifyInstance): Promise<void> | void;
}

export interface PracticeLocation<TPractice extends CoursePractice = CoursePractice> {
  readonly course: Course;
  readonly location: LessonLocation;
  readonly practice: TPractice;
}

/**
 * Resolves `:courseId`/`:lessonId` to a practice assignment of the
 * strategy's own type, or answers the request itself and returns
 * `undefined`.
 *
 * The three refusals are identical for every strategy, and keeping them
 * identical is the point: a learner (or a client) that hits the wrong
 * endpoint gets the same words whichever mechanic they aimed at.
 */
export function resolvePractice(
  request: FastifyRequest<{ Params: { courseId: string; lessonId: string } }>,
  reply: FastifyReply,
  wanted: CoursePracticeType,
): PracticeLocation | undefined {
  const course = request.server.courses.get(request.params.courseId);
  if (course === undefined) {
    void sendCourseNotFound(reply, request.params.courseId);
    return undefined;
  }
  const location = findLesson(course, request.params.lessonId);
  if (location === undefined) {
    void sendLessonNotFound(reply, course.id, request.params.lessonId);
    return undefined;
  }
  const practice = location.lesson.practice;
  if (practice === undefined) {
    void reply.code(404).send({
      error: "practice_not_found",
      message: `Lesson "${location.lesson.id}" of course "${course.id}" has no practice assignment.`,
    });
    return undefined;
  }
  if (practice.type !== wanted) {
    // A 409 rather than a 404: the resource exists and the request is
    // well-formed, it is the state of that resource that makes this
    // endpoint the wrong one (the same call `POST .../complete` makes for
    // a lesson gated by its quiz).
    void reply.code(409).send({
      error: "practice_type_mismatch",
      message:
        `The practice assignment of lesson "${location.lesson.id}" in course "${course.id}" is of type ` +
        `"${practice.type}", not "${wanted}" — submit it to ".../${endpointOf(practice.type)}" instead.`,
    });
    return undefined;
  }
  return { course, location, practice };
}

/**
 * Where the OTHER mechanic wants this request — read out of the capability
 * registry rather than mapped here, so a third type points at its own
 * endpoint without this file knowing it exists.
 */
function endpointOf(type: CoursePracticeType): string {
  return practiceTypeCapability(type)?.submitPath ?? `practice/${type}`;
}
