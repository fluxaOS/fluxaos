export interface CreatePRParams {
	repo: string;
	title: string;
	body: string;
	headBranch: string;
	baseBranch: string;
	draft?: boolean;
}

export interface PullRequest {
	number: number;
	title: string;
	body: string;
	state: "open" | "closed" | "merged";
	headBranch: string;
	baseBranch: string;
	url: string;
	createdAt: Date;
}

export interface GitProvider {
	createBranch(
		repo: string,
		branch: string,
		fromRef?: string,
	): Promise<void>;

	createPullRequest(params: CreatePRParams): Promise<PullRequest>;

	getPullRequest(repo: string, number: number): Promise<PullRequest>;

	listPullRequests(
		repo: string,
		state?: "open" | "closed" | "all",
	): Promise<PullRequest[]>;

	mergePullRequest(
		repo: string,
		number: number,
		method?: "merge" | "squash" | "rebase",
	): Promise<void>;
}
