import type { FollowOptStatisticDetail, GetHomeStatisticParams, HomeLeadStatisticDetail, HomeWinOrderDetail } from '../../models/home';
import { HomeDepartmentTree, HomeFollowOpportunity, HomeLeadStatistic, HomeOpportunityBoardUrl, HomeSuccessOpportunity, HomeOpportunityUnderwayUrl } from '../requrls/home';
import { CrmTreeNodeData } from '@kingcrm/web/src/components/pure/crm-tree/type';
import type { KingAxios } from '@lib/shared/api/http/Axios';

interface BoardPoint {
  name: string;
  value: number;
}

interface OpportunityBoard {
  total: number;
  amount: number;
  unfollowed: number;
  bySource: BoardPoint[];
  byOwnerCount: BoardPoint[];
  byOwnerAmount: BoardPoint[];
  unfollowedByOwner: BoardPoint[];
  byProduct: BoardPoint[];
  trendCount: BoardPoint[];
  trendAmount: BoardPoint[];
}

export default function useHomeApi(CDR: KingAxios) {
  // 用户部门权限树
  function getHomeDepartmentTree() {
    return CDR.get<CrmTreeNodeData[]>({ url: HomeDepartmentTree });
  }

  // 跟进商机统计
  function getHomeFollowOpportunity(data: GetHomeStatisticParams) {
    return CDR.post<FollowOptStatisticDetail>({ url: HomeFollowOpportunity, data });
  }

  // 线索统计
  function getHomeLeadStatistic(data: GetHomeStatisticParams) {
    return CDR.post<HomeLeadStatisticDetail>({ url: HomeLeadStatistic, data });
  }

  function getHomeSuccessOptStatistic(data: GetHomeStatisticParams) {
    return CDR.post<HomeWinOrderDetail>({ url: HomeSuccessOpportunity, data });
  }

  function getHomeOpportunityUnderwayStatistic(data: GetHomeStatisticParams) {
    return CDR.post<HomeWinOrderDetail>({ url: HomeOpportunityUnderwayUrl, data });
  }

  function getOpportunityBoard(data: { deptIds?: string[]; start: number; end: number }) {
    return CDR.post<OpportunityBoard>({ url: HomeOpportunityBoardUrl, data });
  }

  return {
    getHomeDepartmentTree,
    getHomeFollowOpportunity,
    getHomeLeadStatistic,
    getHomeSuccessOptStatistic,
    getHomeOpportunityUnderwayStatistic,
    getOpportunityBoard,
  };
}
