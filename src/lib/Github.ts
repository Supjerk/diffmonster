import { Observable } from 'rxjs/Observable';
import 'rxjs/add/observable/of';
import 'rxjs/add/observable/throw';
import 'rxjs/add/observable/dom/ajax';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/exhaustMap';
import LinkHeader from 'http-link-header';
import { getAccessToken } from './GithubAuth';
import { AjaxRequest, AjaxResponse } from 'rxjs/observable/dom/AjaxObservable';

const BASE_URL = 'https://api.github.com';

export const PullRequestReviewState = {
  PENDING: 'PENDING',
  COMMENTED: 'COMMENTED',
  APPROVED: 'APPROVED',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  DISMISSED: 'DISMISSED',
};

export type PullRequestReviewStateType = keyof (typeof PullRequestReviewState);

export const PullRequestReviewEvent = {
  PENDING: null,
  COMMENT: 'COMMENT' as PullRequestReviewEventInput,
  APPROVE: 'APPROVE' as PullRequestReviewEventInput,
  REQUEST_CHANGES: 'REQUEST_CHANGES' as PullRequestReviewEventInput,
  DISMISS: 'DISMISS',
};

export type PullRequestReviewEventInput = null | 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

export const pullRequestReviewFragment = `
  id
  state
  viewerDidAuthor
  createdAt
  databaseId
`;

export const pullRequestReviewCommentRestLikeFragment = `
  id: databaseId
  node_id: id
  user: author {
    html_url: url
    login
  }
  body
  path
  position
`;

export interface PullRequestDTO {
  id: number;
  node_id: string;
  number: number;
  url: string;
  html_url: string;
  title: string;
  body: string;
  base: {
    sha: string;
    repo: {
      url: string;
      html_url: string;
      full_name: string;
    };
  };
  head: {
    sha: string;
    repo: {
      url: string;
      html_url: string;
      full_name: string;
    };
  };
}

export interface PullRequestCommentDTO {
  id: number;
  node_id: string;
  user: {
    html_url: string;
    login: string;
  };
  body: string;
  path: string;
  position: number;
}

export interface PullRequestReviewCommentsConnection {
  nodes: PullRequestCommentDTO[];
  pageInfo: {
    hasPreviousPage: boolean;
    startCursor: string;
  };
}

export interface PullRequestReviewDTO {
  id: string;
  state: PullRequestReviewStateType;
  comments?: PullRequestReviewCommentsConnection;
}

function ajax(request: AjaxRequest): Observable<AjaxResponse> {
  if (!request.responseType)
    request.responseType = 'json'; 
  if (!request.headers)
    request.headers = {};
  const headers: any = request.headers;
  // https://developer.github.com/v3/#graphql-global-relay-ids
  if (!headers['Accept'])
    headers['Accept'] = 'application/vnd.github.jean-grey-preview+json';
  
  const token = getAccessToken();
  if (token)
    headers['Authorization'] = `token ${token}`;
  return Observable.ajax(request);
}

export interface GraphQLError {
  type: 'NOT_FOUND';
}

export function graphql(query: string, variables: {[key: string]: any}): Observable<any> {
  const request = {
    url: `${BASE_URL}/graphql`,
    method: 'post',
    headers: <any>{
      'Content-Type': 'application/json',
    },
    responseType: 'json',
    body: JSON.stringify({ query, variables }),
  };
  
  const token = getAccessToken();
  if (token)
    request.headers['Authorization'] = `bearer ${token}`;
  return Observable.ajax(request)
    .exhaustMap(resp => resp.response.errors ?
      Observable.throw(resp.response.errors) :
      Observable.of(resp.response.data));
}

function pullRequestUrl(owner: string, repo: string, number: number): string {
  return `${BASE_URL}/repos/${owner}/${repo}/pulls/${number}`;
}

export function getPullRequest(owner: string, repo: string, number: number): Observable<PullRequestDTO> {
  return ajax({
    url: pullRequestUrl(owner, repo, number),
    method: 'get',
  }).map(resp => resp.response);
}

function paginated<T>(obs: Observable<AjaxResponse>): Observable<T[]> {
  return obs.exhaustMap(resp => {
    const link = LinkHeader.parse(resp.xhr.getResponseHeader('Link') || '');
    const next = link.rel('next');
    if (next && next.length === 1) {
      return paginated(ajax({url: next[0].uri, method: 'get'}))
        .map(result => resp.response.concat(result));
    }
    return Observable.of(resp.response);
  });
}

export function getPullRequestAsDiff(owner: string, repo: string, number: number): Observable<string> {
  return ajax({
    // Append query string to prevent interfering caches
    url: `${pullRequestUrl(owner, repo, number)}?.diff`,
    method: 'get',
    headers: {
      'Accept': 'application/vnd.github.v3.diff',
    },
    responseType: 'text',
  }).map(resp => resp.response);
}

export function getPullRequestComments(pullRequest: PullRequestDTO): Observable<PullRequestCommentDTO[]> {
  return paginated(ajax({
    url: `${pullRequest.url}/comments`,
    method: 'get',
  }));
}

export function getPullRequestFromGraphQL(owner: string, repo: string, number: number, author: string, fragment: string): Observable<PullRequestDTO> {
  return graphql(`
    query($owner: String!, $repo: String!, $number: Int!, $author: String!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          ${fragment}
        }
      }
    }
  `, { owner, repo, number, author })
    .map(resp => resp.repository.pullRequest);
}

export function getAuthenticatedUser(): Observable<any> {
  return ajax({
    url: `${BASE_URL}/user`,
    method: 'get',
  }).map(resp => resp.response);
}

export function getPullRequestReviewComments(pullRequest: PullRequestDTO, reviewId: string, startCursor: string): Observable<PullRequestCommentDTO[]> {
  return graphql(`
    query($reviewId: ID!, $startCursor: String) {
      node(id: $reviewId) {
        ... on PullRequestReview {
          comments(last: 100, before: $startCursor) {
            nodes {
              ${pullRequestReviewCommentRestLikeFragment}
            }
            pageInfo {
              hasPreviousPage
              startCursor
            }
          }
        }
      }
    }
  `, { reviewId, startCursor })
    .exhaustMap(resp => {
      const comments = resp.node.comments;
      if (comments.pageInfo.hasPreviousPage) {
        return getPullRequestReviewComments(pullRequest, reviewId, comments.pageInfo.startCursor)
          .map(result => result.concat(comments.nodes));
      }
      return Observable.of(comments.nodes);
    });
}

export interface AddPullRequestReviewInputComment {
  body: string;
  position: number;
  path: string;
}

export function addPullRequestReview(pullRequestId: string, commitId: string, event: PullRequestReviewEventInput, comments: AddPullRequestReviewInputComment[] = []): Observable<PullRequestReviewDTO> {
  return graphql(`
    mutation($input: AddPullRequestReviewInput!, $commentCount: Int) {
      addPullRequestReview(input: $input) {
        pullRequestReview {
          ${pullRequestReviewFragment}
          comments(first: $commentCount) {
            nodes {
              ${pullRequestReviewCommentRestLikeFragment}
            }
          }
        }
      }
    }
  `, {
    input: {
      pullRequestId,
      commitOID: commitId,
      event,
      comments,
    },
    commentCount: comments.length,
  }).map(resp => resp.addPullRequestReview.pullRequestReview);
}

export function submitPullRequestReview(pullRequestReviewId: string, event: PullRequestReviewEventInput): Observable<PullRequestReviewDTO> {
  return graphql(`
    mutation($input: SubmitPullRequestReviewInput!) {
      submitPullRequestReview(input: $input) {
        pullRequestReview {
          ${pullRequestReviewFragment}
        }
      }
    }
  `, {
    input: {
      pullRequestReviewId,
      event,
    }
  }).map(resp => resp.submitPullRequestReview.pullRequestReview);
}

export function addPullRequestReviewCommentOnReview(reviewId: string, commitId: string, body: string, path: string, position: number): Observable<PullRequestCommentDTO> {
  return graphql(`
    mutation($input: AddPullRequestReviewCommentInput!) {
      addPullRequestReviewComment(input: $input) {
        comment {
          ${pullRequestReviewCommentRestLikeFragment}
        }
      }
    }
  `, {
    input: {
      pullRequestReviewId: reviewId,
      commitOID: commitId,
      body,
      path,
      position,
    }
  }).map(resp => resp.addPullRequestReviewComment.comment);
}

export function deletePullRequestReviewComment(pullRequest: PullRequestDTO, commentId: number): Observable<any> {
  return ajax({
    url: `${pullRequest.base.repo.url}/pulls/comments/${commentId}`,
    method: 'DELETE',
  });
}

export function editPullRequestReviewComment(pullRequest: PullRequestDTO, commentId: number, { body }: { body: string }): Observable<PullRequestCommentDTO> {
  return ajax({
    url: `${pullRequest.base.repo.url}/pulls/comments/${commentId}`,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  }).map(resp => resp.response);
}

export function editPullRequestReviewCommentViaGraphQL(commentNodeId: string, { body }: { body: string }): Observable<PullRequestCommentDTO> {
  return graphql(`
    mutation($input: UpdatePullRequestReviewCommentInput!) {
      updatePullRequestReviewComment(input: $input) {
        pullRequestReviewComment {
          ${pullRequestReviewCommentRestLikeFragment}
        }
      }
    }
  `, {
    input: {
      pullRequestReviewCommentId: commentNodeId,
      body,
    }
  }).map(resp => resp.updatePullRequestReviewComment.pullRequestReviewComment);
}
