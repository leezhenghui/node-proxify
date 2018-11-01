/**
 * Copyright 2018, leezhenghui@gmail.com.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 *
 * @module Provides runtime interceptor framework
 *
 */

import * as Debug from 'debug';
import * as Q from 'q';
import { InteractionStyleType } from '../metadata/common';
import { InterceptorMetadata } from '../metadata/interceptor';
import { OperationMetadata } from '../metadata/operation';
import {
  InteractionType,
  Interaction,
  Fault,
  InvocationContext,
  Processor,
  ProcessStatus,
  canProcessCallbackFn,
  ProcessorNexter,
} from '../runtime/invocation';

import { AnyFn } from '../util/types';

export { canProcessCallbackFn } from '../runtime/invocation';
export type doneFn = (error?: any) => void;

const debug: Debug.IDebugger = Debug('proxify:runtime:interceptor');

export abstract class AbstractInterceptor extends Processor {
  constructor(config: any) {
    super();
  }

  public abstract canProcess(context: InvocationContext, callback: canProcessCallbackFn): void;

  public init(context: InvocationContext, done: doneFn): void {
    done();
  }

  public handleRequest(context: InvocationContext, done: doneFn): void {
    done();
  }

  public handleResponse(context: InvocationContext, done: doneFn): void {
    done();
  }

  public handleFault(context: InvocationContext, done: doneFn): void {
    done();
  }

  public _process(context: InvocationContext, next: ProcessorNexter): void {
    const self: AbstractInterceptor = this;
    const method: string = self.getName() + '._process';
    context.__setCurrentProcessor(self);
    debug(method + ' [Etner]', context);

    self.canProcess(
      context,
      function(error: any, canProcess: boolean) {
        const interactionType: InteractionType = context.getInteractionType();
        if (!canProcess) {
          if (
            interactionType === InteractionType.INTERACTION_LOCATE ||
            interactionType === InteractionType.INTERACTION_INVOKE
          ) {
            self._getNext()._process(
              context,
              function(error: any, status: ProcessStatus) {
                next(error, status);
              }.bind(self),
            );
          } else {
            self._getPrevious()._process(
              context,
              function(error: any, status: ProcessStatus) {
                next(error, status);
              }.bind(self),
            );
          }
          return;
        }

        try {
          switch (interactionType) {
            case InteractionType.INTERACTION_LOCATE:
              self.init(
                context,
                function(error: any) {
                  if (error) {
                    return self.switchToFaultFlow(
                      error,
                      context,
                      function(error: any, status: ProcessStatus) {
                        next(error, status);
                      }.bind(self),
                    );
                  }
                  return self._getNext()._process(
                    context,
                    function(error: any, status: ProcessStatus) {
                      next(error, status);
                    }.bind(self),
                  );
                }.bind(self),
              );
              break;
            case InteractionType.INTERACTION_LOCATE_RESULT:
              self._getPrevious()._process(
                context,
                function(error: any, status: ProcessStatus) {
                  next(error, status);
                }.bind(self),
              );
              break;
            case InteractionType.INTERACTION_INVOKE:
              self.handleRequest(
                context,
                function(error: any) {
                  if (error) {
                    return self.switchToFaultFlow(
                      error,
                      context,
                      function(error: any, status: ProcessStatus) {
                        next(error, status);
                      }.bind(self),
                    );
                  }
                  return self._getNext()._process(
                    context,
                    function(error: any, status: ProcessStatus) {
                      next(error, status);
                    }.bind(self),
                  );
                }.bind(self),
              );
              break;
            case InteractionType.INTERACTION_INVOKE_RESULT:
              self.handleResponse(
                context,
                function(error: any) {
                  if (error) {
                    return self.switchToFaultFlow(
                      error,
                      context,
                      function(error: any, status: ProcessStatus) {
                        next(error, status);
                      }.bind(self),
                    );
                  }
                  return self._getPrevious()._process(
                    context,
                    function(error: any, status: ProcessStatus) {
                      next(error, status);
                    }.bind(self),
                  );
                }.bind(self),
              );
              break;
            case InteractionType.INTERACTION_INVOKE_FAULT:
              self.handleFault(
                context,
                function(error: any) {
                  return self._getPrevious()._process(
                    context,
                    function(error: any, status: ProcessStatus) {
                      next(error, status);
                    }.bind(self),
                  );
                }.bind(self),
              );
              break;
            default:
              throw new Error('Invalid interaction type: ' + interactionType);
          }
        } catch (error) {
          debug(method + ' [catch error]: ', error);
          switch (interactionType) {
            case InteractionType.INTERACTION_LOCATE:
            case InteractionType.INTERACTION_LOCATE_RESULT:
            case InteractionType.INTERACTION_INVOKE:
            case InteractionType.INTERACTION_INVOKE_RESULT:
              self.switchToFaultFlow(
                error,
                context,
                function(error: any, status: ProcessStatus) {
                  next(error, status);
                }.bind(self),
              );
              break;
            case InteractionType.INTERACTION_INVOKE_FAULT:
              // TODO, log error here
              self._getPrevious()._process(
                context,
                function(error: any, status: ProcessStatus) {
                  next(error, status);
                }.bind(self),
              );
              break;
            default:
              throw new Error('Invalid interaction type: ' + interactionType);
          }
        } // end catch
      }.bind(self),
    );
  }

  private switchToFaultFlow(
    error: any,
    context: InvocationContext,
    next: (error: any, status: ProcessStatus) => void,
  ): void {
    const self: AbstractInterceptor = this;
    let fault: Fault;
    if (error instanceof Fault) {
      fault = error;
    } else {
      fault = new Fault(self.getName(), null, null, null);
      fault.errorCode = error.errorCode;
      fault.reason = error.message || error.reason;
      fault.details = error;
    }
    context.setInteractionType(InteractionType.INTERACTION_INVOKE_FAULT);
    context.fault = fault;

    self._process(
      context,
      function(error: any, status: ProcessStatus) {
        next(error, status);
      }.bind(self),
    );
  }
}

/**
 * Interceptor registry class
 *
 */
export class Registry<I extends Processor, M extends InterceptorMetadata> {
  private __interceptors__: { [name: string]: M } = {};

  /**
   * @method, get interceptor class definition
   *
   */
  public getInterceptorClass(name: string): AnyFn {
    const method: string = 'Registry.getInterceptorClass';
    debug(method + ' [Enter]', name);

    const ides: M = this.__interceptors__[name];
    if (!ides) {
      debug(method + ' [WARNING]: Missing interceptor "' + name + '" in registry');
      debug(method + ' [Exit]');
      return null;
    }

    debug(method + ' [Exit]', name, ides.__class__);
    return ides.__class__;
  }

  /**
   * @method, get interceptor metadata
   *
   */
  public getInterceptorMetadata(name: string): M {
    const method: string = 'Registry.getInterceptorMetadata';
    debug(method + ' [Enter]', name);

    const ides: M = this.__interceptors__[name];
    if (!ides) {
      debug(method + ' [WARNING]: Missing interceptor "' + name + '" in registry');
      debug(method + ' [Exit]');
      return null;
    }

    debug(method + ' [Exit]', name, ides);
    return ides;
  }

  /**
   * @method, register a new interceptor with metadata
   *
   */
  public register(ides: M): void {
    const method: string = 'Registry.register';
    debug(method + ' [Enter]', ides);
    if (!ides) {
      debug(method + ' [Exit]', ides);
      return;
    }

    if (this.__interceptors__[ides.__class__.name]) {
      debug(method + ' [WARNING]: Dumplicated interceptor definitions: "' + ides.__class__.name + '" in registry');

      debug(method + ' [Exit](failed)', ides);
      return;
    }

    if (ides.__class__.name && ides.__class__.name.indexOf('system:') === 0) {
      throw new Error('Interceptor name can not start with "system:"');
    }
    this.__interceptors__[ides.__class__.name] = ides;
    debug(method + ' [Exit]', ides);
  }
}

/**
 * Export singletone registry
 */
export let interceptorRegistry: Registry<Processor, InterceptorMetadata> = new Registry();
